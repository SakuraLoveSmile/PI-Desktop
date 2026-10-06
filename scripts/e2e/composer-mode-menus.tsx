import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { TFunction } from "i18next";
import type { ExecutionProfile, Mode } from "@pi-desktop/shared";
import { ComposerExecutionProfilePicker } from "../../apps/desktop/src/features/chat/composer/ComposerExecutionProfilePicker";
import { ComposerContractPicker } from "../../apps/desktop/src/features/chat/composer/ComposerContractPicker";
import { ComposerPlusMenu } from "../../apps/desktop/src/features/chat/composer/ComposerPlusMenu";

const labels: Record<string, string> = {
  "chat.executionProfile": "Execution profile",
  "chat.profileAgent": "智能体",
  "chat.profileAgentDesc": "Single agent",
  "chat.profileTeam": "专家团",
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
  const [plusOpen, setPlusOpen] = useState(false);

  return (
    <div className="composer-stack"><div className="composer-shell">
      <div className="composer-toolbar"><div className="composer-left">
        <ComposerPlusMenu
          t={t} mode={mode} executionProfile={profile} open={plusOpen}
          setOpen={setPlusOpen} onSelectMode={setMode} onSelectProfile={setProfile}
          onPickAndAttach={() => {}} onInsertReference={() => {}} onInsertCommand={() => {}}
          onCloseOtherMenus={() => setProfileOpen(false)}
        />
        <ComposerExecutionProfilePicker
          t={t} executionProfile={profile} open={profileOpen}
          setOpen={setProfileOpen} onSelectProfile={setProfile}
          onCloseOtherMenus={() => setPlusOpen(false)}
        />
        <ComposerContractPicker
          t={t} mode={mode} planningLive={false}
          onClick={() => { setProfileOpen(false); setPlusOpen(true); }}
        />
      </div></div>
    </div></div>
  );
}

createRoot(document.getElementById("root")!).render(<PickerFixture />);
