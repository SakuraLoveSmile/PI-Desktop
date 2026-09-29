import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { TFunction } from "i18next";
import type { ExecutionProfile, Mode } from "@pi-desktop/shared";
import { ComposerExecutionProfilePicker } from "../../apps/desktop/src/features/chat/composer/ComposerExecutionProfilePicker";
import { ComposerContractPicker } from "../../apps/desktop/src/features/chat/composer/ComposerContractPicker";

const labels: Record<string, string> = {
  "chat.executionProfile": "Execution profile",
  "chat.profileAgent": "Agent",
  "chat.profileAgentDesc": "Single agent",
  "chat.profileTeam": "Expert Team",
  "chat.profileTeamDesc": "Work with teammates",
  "chat.contractMode": "Contract mode",
  "chat.contractNone": "Normal",
  "chat.contractNoneDesc": "No contract",
  "chat.contractPlanDesc": "Create a plan",
  "chat.contractGoalDesc": "Complete a goal",
  "settings.modePlan": "Plan",
  "settings.modeGoal": "Goal",
};
const t = ((key: string) => labels[key] ?? key) as TFunction;

function PickerFixture() {
  const [profile, setProfile] = useState<ExecutionProfile>("standard");
  const [mode, setMode] = useState<Mode>("agent");
  const [profileOpen, setProfileOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  return (
    <div className="composer-stack"><div className="composer-shell">
      <div className="composer-toolbar"><div className="composer-left">
        <ComposerExecutionProfilePicker
          t={t} executionProfile={profile} open={profileOpen}
          setOpen={setProfileOpen} onSelectProfile={setProfile}
          onCloseOtherMenus={() => setContractOpen(false)}
        />
        <ComposerContractPicker
          t={t} mode={mode} planningLive={false} open={contractOpen}
          setOpen={setContractOpen} onSelectMode={setMode}
          onCloseOtherMenus={() => setProfileOpen(false)}
        />
      </div></div>
    </div></div>
  );
}

createRoot(document.getElementById("root")!).render(<PickerFixture />);
