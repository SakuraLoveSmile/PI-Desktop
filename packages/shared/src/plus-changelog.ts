import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Track live progress for approved Goals and review their completion reports.",
        "Keep successful task dispatches visible in expert cards, with links to task details.",
        "Improve pinned session titles, model menus, and optional skill discovery.",
      ],
    },
  ],
  "zh-CN": [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "跟踪已批准目标的实时进度，并查看完成报告。",
        "专家任务卡片会保留成功派发的状态，并链接到任务详情。",
        "改进固定会话标题、模型菜单和可选技能发现。",
      ],
    },
  ],
  "zh-TW": [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "追蹤已核准目標的即時進度，並檢視完成報告。",
        "專家任務卡片會保留成功派送的狀態，並連結至任務詳細資訊。",
        "改進釘選工作階段標題、模型選單和選用技能探索。",
      ],
    },
  ],
  tr: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Onaylanan hedeflerin canlı ilerlemesini takip edin ve tamamlanma raporlarını görüntüleyin.",
        "Uzman görev kartlarında başarıyla gönderilen görevlerin durumunu koruyun ve görev ayrıntılarına bağlantı verin.",
        "Sabitlenmiş oturum başlıkları, model menüleri ve isteğe bağlı beceri keşfi iyileştirildi.",
      ],
    },
  ],
  de: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Verfolgen Sie den Live-Fortschritt genehmigter Ziele und sehen Sie sich Abschlussberichte an.",
        "Erfolgreich verteilte Aufgaben bleiben in Expertenkarten sichtbar und sind mit den Aufgabendetails verknüpft.",
        "Verbesserungen für angeheftete Sitzungstitel, Modellmenüs und die optionale Skill-Suche.",
      ],
    },
  ],
  es: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Sigue el progreso en directo de los objetivos aprobados y consulta sus informes de finalización.",
        "Las tarjetas de expertos conservan las tareas enviadas correctamente y enlazan a sus detalles.",
        "Mejora los títulos de sesiones fijadas, los menús de modelos y el descubrimiento opcional de habilidades.",
      ],
    },
  ],
  fr: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Suivez la progression en direct des objectifs approuvés et consultez leurs rapports d'achèvement.",
        "Les cartes d'experts conservent les tâches distribuées avec succès et proposent un lien vers leurs détails.",
        "Améliore les titres des sessions épinglées, les menus de modèles et la découverte facultative de compétences.",
      ],
    },
  ],
  ko: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "승인된 목표의 실시간 진행 상황을 추적하고 완료 보고서를 확인하세요.",
        "전문가 작업 카드에 성공적으로 전달된 작업 상태를 유지하고 작업 상세 정보로 연결합니다.",
        "고정된 세션 제목, 모델 메뉴, 선택적 스킬 검색을 개선했습니다.",
      ],
    },
  ],
  "pt-BR": [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Acompanhe o progresso em tempo real de metas aprovadas e consulte os relatórios de conclusão.",
        "Os cartões de especialistas mantêm visíveis as tarefas enviadas com sucesso e incluem links para seus detalhes.",
        "Melhora títulos de sessões fixadas, menus de modelos e a descoberta opcional de skills.",
      ],
    },
  ],
};

const catalogs = new WeakMap<
  readonly ChangelogEntry[],
  Map<ChangelogLocale, readonly ChangelogEntry[]>
>();

/** Overlay Plus releases and retain upstream history starting at the cutoff. */
export function withPlusEntries(
  locale: ChangelogLocale,
  upstream: readonly ChangelogEntry[],
): readonly ChangelogEntry[] {
  let byLocale = catalogs.get(upstream);
  const existing = byLocale?.get(locale);
  if (existing) return existing;

  const cutoffIndex = upstream.findIndex((entry) => entry.version === PLUS_UPSTREAM_CUTOFF);
  const catalog = [
    ...plusEntries[locale],
    ...(cutoffIndex < 0 ? [] : upstream.slice(cutoffIndex)),
  ];
  if (!byLocale) {
    byLocale = new Map();
    catalogs.set(upstream, byLocale);
  }
  byLocale.set(locale, catalog);
  return catalog;
}
