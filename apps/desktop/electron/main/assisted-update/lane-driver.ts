import type { UpdateState } from "@pi-desktop/shared";
import { isAbortError } from "./errors";
import type { AssistedUpdateLane } from "./service";

export type AssistedOffer = { version: string; files?: unknown };

/** What the driver needs from the update controller. */
export type AssistedLaneHost = {
  state(): UpdateState;
  setState(patch: Partial<UpdateState>): void;
  /** The user dismissed the notice for this version. */
  isDismissed(version: string): boolean;
  releaseNotes(version: string): string | undefined;
  /** Whether the manual-mode reminder should show for a version (and records it). */
  manualReminder(version: string): boolean;
  isDisposed(): boolean;
  log(level: "info" | "warn", message: string, data: Record<string, unknown>): void;
};

/**
 * The controller's side of the assisted lane: turns a feed offer into a
 * download, keeps the results of superseded, dismissed or disposed downloads
 * out of the state, and gates everything on the previous run's cleanup. The
 * lane itself (./service) knows nothing about update states.
 */
export class AssistedLaneDriver {
  private readonly lane: AssistedUpdateLane;
  private readonly host: AssistedLaneHost;
  private active: { version: string; controller: AbortController } | null = null;
  private offer: AssistedOffer | null = null;
  private recovery: Promise<void> = Promise.resolve();
  private recovered = true;

  constructor(lane: AssistedUpdateLane, host: AssistedLaneHost) {
    this.lane = lane;
    this.host = host;
  }

  /** Settles what earlier installs left behind; downloads wait for it. */
  recover(): void {
    this.recovered = false;
    this.recovery = this.lane
      .recover()
      .then((outcome) => {
        if (outcome.confirmed) {
          this.host.log("info", "assisted update confirmed", {
            version: this.host.state().currentVersion,
          });
        }
      })
      .catch((error: unknown) => {
        this.host.log("warn", "assisted update recovery failed", { detail: String(error) });
      })
      .finally(() => {
        this.recovered = true;
      });
  }

  /** The feed offered `offer`; it downloads on its own unless the user declined it. */
  onOffer(offer: AssistedOffer): void {
    const decide = () => {
      const { version } = offer;
      const dismissed = this.host.isDismissed(version);
      const failed = this.lane.skipsAutoInstall(version);
      const automatic = this.host.state().mode === "in-app" && !dismissed && !failed;
      this.offer = offer;
      this.host.setState({
        status: automatic ? "downloading" : "available",
        availableVersion: version,
        releaseNotes: this.host.releaseNotes(version),
        progressPercent: automatic ? 0 : undefined,
        dismissed,
        assistedInstallFailed: failed || undefined,
        manualReminder: automatic ? false : this.host.manualReminder(version),
      });
      if (automatic) void this.start(offer);
    };
    if (this.recovered) decide();
    else void this.recovery.then(() => !this.host.isDisposed() && decide());
  }

  /** The user asked to download the offered version (a retry, or a dismissed offer). */
  async download(version: string | undefined): Promise<void> {
    const offer = this.offer;
    if (!offer || offer.version !== version) {
      throw new Error("no update has been offered to download");
    }
    await this.recovery;
    await this.start(offer);
  }

  dismiss(version: string): void {
    if (this.lane.hasPendingInstall()) return;
    this.cancel(version);
    void this.lane.discardPrepared();
  }

  /** Starts the helper; the controller quits only after this resolves. */
  install(): Promise<void> {
    return this.lane.install();
  }

  /** Written by the quit path once the sidecar and host-core have stopped. */
  commit(): Promise<void> {
    return this.lane.commitPendingInstall();
  }

  dispose(): void {
    this.cancel();
  }

  private async start(offer: AssistedOffer): Promise<void> {
    this.cancel();
    const handle = { version: offer.version, controller: new AbortController() };
    this.active = handle;
    const current = () => this.active === handle && !this.host.isDisposed();
    this.host.setState({ status: "downloading", progressPercent: 0, error: undefined });
    try {
      await this.lane.prepare(offer, {
        signal: handle.controller.signal,
        onProgress: (percent) => {
          if (current()) this.host.setState({ status: "downloading", progressPercent: percent });
        },
      });
    } catch (error) {
      if (this.active === handle) this.active = null;
      if (handle.controller.signal.aborted || isAbortError(error)) return;
      this.host.log("warn", "assisted update failed", {
        detail: String(error),
        version: offer.version,
      });
      this.host.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!current()) {
      await this.lane.discardPrepared();
      return;
    }
    this.active = null;
    const dismissed = this.host.isDismissed(offer.version);
    this.host.setState({
      status: dismissed ? "available" : "downloaded",
      availableVersion: offer.version,
      releaseNotes: this.host.releaseNotes(offer.version),
      progressPercent: dismissed ? undefined : 100,
      dismissed,
      manualReminder: false,
    });
  }

  private cancel(version?: string): void {
    if (!this.active || (version !== undefined && this.active.version !== version)) return;
    this.active.controller.abort();
    this.active = null;
  }
}
