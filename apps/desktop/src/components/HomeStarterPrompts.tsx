import { useTranslation } from "react-i18next";
import {
  IconArrowUpRight,
  IconDiff,
  IconFolderOpen,
  IconSparkles,
  IconWrench,
} from "./icons";

type HomeStarterPrompt = {
  id: "explore" | "build" | "fix" | "review";
  titleKey: string;
  descriptionKey: string;
  promptKey: string;
  icon: typeof IconFolderOpen;
};

const HOME_STARTERS: readonly HomeStarterPrompt[] = [
  {
    id: "explore",
    titleKey: "chat.starterExploreTitle",
    descriptionKey: "chat.starterExploreDescription",
    promptKey: "chat.starterExplorePrompt",
    icon: IconFolderOpen,
  },
  {
    id: "build",
    titleKey: "chat.starterBuildTitle",
    descriptionKey: "chat.starterBuildDescription",
    promptKey: "chat.starterBuildPrompt",
    icon: IconSparkles,
  },
  {
    id: "fix",
    titleKey: "chat.starterFixTitle",
    descriptionKey: "chat.starterFixDescription",
    promptKey: "chat.starterFixPrompt",
    icon: IconWrench,
  },
  {
    id: "review",
    titleKey: "chat.starterReviewTitle",
    descriptionKey: "chat.starterReviewDescription",
    promptKey: "chat.starterReviewPrompt",
    icon: IconDiff,
  },
];

type HomeStarterPromptsProps = {
  onPrefill: (prompt: string) => void;
};

export function HomeStarterPrompts({ onPrefill }: HomeStarterPromptsProps) {
  const { t } = useTranslation();

  return (
    <section
      className="home-starters"
      aria-labelledby="home-starters-title"
      data-testid="home-starters"
    >
      <h2 id="home-starters-title" className="home-starters-label">
        {t("chat.startersTitle")}
      </h2>
      <div className="home-starters-grid">
        {HOME_STARTERS.map((starter) => {
          const StarterIcon = starter.icon;
          return (
            <button
              key={starter.id}
              type="button"
              className="home-starter-card"
              onClick={() => onPrefill(t(starter.promptKey))}
            >
              <span className="home-starter-icon" aria-hidden>
                <StarterIcon size={16} />
              </span>
              <span className="home-starter-copy">
                <span className="home-starter-card-title">
                  {t(starter.titleKey)}
                </span>
                <span className="home-starter-card-description">
                  {t(starter.descriptionKey)}
                </span>
              </span>
              <IconArrowUpRight
                className="home-starter-card-arrow"
                size={15}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
