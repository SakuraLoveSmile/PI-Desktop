import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/*
 * The execution-profile chip's first frame: Agent is a single person, Expert
 * Team the group, so the two read apart from each other and from the model
 * chip, which keeps Bot.
 */

const key = (value) => value;

test("the profile chip shows a single-person icon for Agent and the group icon for Expert Team", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerExecutionProfilePicker } = await ssr.load("/src/features/chat/composer/ComposerExecutionProfilePicker.tsx");
  const chip = (executionProfile) =>
    ssr.render(
      createElement(ComposerExecutionProfilePicker, {
        t: key,
        executionProfile,
        open: false,
        setOpen: () => {},
        onSelectProfile: () => {},
      }),
    );

  const agent = chip("standard");
  const team = chip("team");
  assert.match(agent, /lucide-user-round/);
  assert.doesNotMatch(agent, /lucide-users|lucide-bot/);
  assert.match(team, /lucide-users/);
  assert.doesNotMatch(team, /lucide-user-round|lucide-bot/);
});
