import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Require Expert Team delegation for every task; launch read-only Plan research automatically while keeping execution roster approval.",
        "Track live progress for approved Goals and review their completion reports.",
        "Keep successful task dispatches visible in expert cards, with links to task details.",
        "Improve pinned session titles, model menus, and optional skill discovery.",
        "Guide standard agents to delegate substantial work and Expert Team Leads to assign work to experts.",
      ],
    },
  ],
  "zh-CN": [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "专家团所有任务都需委派专家；规划自动启动只读研究，执行名单仍需用户批准。",
        "跟踪已批准目标的实时进度，并查看完成报告。",
        "专家任务卡片会保留成功派发的状态，并链接到任务详情。",
        "改进固定会话标题、模型菜单和可选技能发现。",
        "引导标准智能体优先委派重要工作，并由专家团 Lead 将任务分配给专家。",
      ],
    },
  ],
  "zh-TW": [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "專家團所有任務都需委派專家；規劃自動啟動唯讀研究，執行名單仍需使用者核准。",
        "追蹤已核准目標的即時進度，並檢視完成報告。",
        "專家任務卡片會保留成功派送的狀態，並連結至任務詳細資訊。",
        "改進釘選工作階段標題、模型選單和選用技能探索。",
        "引導標準智能體優先委派重要工作，並由專家團 Lead 將任務分配給專家。",
      ],
    },
  ],
  tr: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Uzman Ekipte her görev için yetki devri zorunludur; salt okunur Plan araştırması otomatik başlar, yürütme kadrosu onayı korunur.",
        "Onaylanan hedeflerin canlı ilerlemesini takip edin ve tamamlanma raporlarını görüntüleyin.",
        "Uzman görev kartlarında başarıyla gönderilen görevlerin durumunu koruyun ve görev ayrıntılarına bağlantı verin.",
        "Sabitlenmiş oturum başlıkları, model menüleri ve isteğe bağlı beceri keşfi iyileştirildi.",
        "Standart ajanları önemli işleri devretmeye, Uzman Ekip Liderlerini işleri uzmanlara atamaya yönlendirin.",
      ],
    },
  ],
  de: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Expertenteams delegieren jede Aufgabe; schreibgeschützte Plan-Recherche startet automatisch, das Ausführungsteam bleibt genehmigungspflichtig.",
        "Verfolgen Sie den Live-Fortschritt genehmigter Ziele und sehen Sie sich Abschlussberichte an.",
        "Erfolgreich verteilte Aufgaben bleiben in Expertenkarten sichtbar und sind mit den Aufgabendetails verknüpft.",
        "Verbesserungen für angeheftete Sitzungstitel, Modellmenüs und die optionale Skill-Suche.",
        "Standardagenten werden zum Delegieren wichtiger Aufgaben und Expertenteam-Leads zum Zuweisen an Experten angeleitet.",
      ],
    },
  ],
  es: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Los equipos de expertos delegan todas las tareas; la investigación de Plan de solo lectura se inicia automáticamente y el equipo de ejecución requiere aprobación.",
        "Sigue el progreso en directo de los objetivos aprobados y consulta sus informes de finalización.",
        "Las tarjetas de expertos conservan las tareas enviadas correctamente y enlazan a sus detalles.",
        "Mejora los títulos de sesiones fijadas, los menús de modelos y el descubrimiento opcional de habilidades.",
        "Orienta a los agentes estándar a delegar trabajo importante y a los líderes de equipos expertos a asignarlo a especialistas.",
      ],
    },
  ],
  fr: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Les équipes d'experts délèguent chaque tâche ; la recherche Plan en lecture seule démarre automatiquement et l'équipe d'exécution reste soumise à approbation.",
        "Suivez la progression en direct des objectifs approuvés et consultez leurs rapports d'achèvement.",
        "Les cartes d'experts conservent les tâches distribuées avec succès et proposent un lien vers leurs détails.",
        "Améliore les titres des sessions épinglées, les menus de modèles et la découverte facultative de compétences.",
        "Incitez les agents standard à déléguer les tâches importantes et les responsables d'équipe à les confier aux experts.",
      ],
    },
  ],
  ko: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "전문가 팀은 모든 작업을 위임합니다. Plan의 읽기 전용 연구는 자동으로 시작되며 실행 명단은 사용자 승인이 필요합니다.",
        "승인된 목표의 실시간 진행 상황을 추적하고 완료 보고서를 확인하세요.",
        "전문가 작업 카드에 성공적으로 전달된 작업 상태를 유지하고 작업 상세 정보로 연결합니다.",
        "고정된 세션 제목, 모델 메뉴, 선택적 스킬 검색을 개선했습니다.",
        "표준 에이전트는 중요한 작업을 위임하고 전문가 팀 리드는 전문가에게 작업을 배정하도록 안내합니다.",
      ],
    },
  ],
  "pt-BR": [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Equipes de especialistas delegam todas as tarefas; a pesquisa somente leitura do Plan inicia automaticamente e a equipe de execução exige aprovação.",
        "Acompanhe o progresso em tempo real de metas aprovadas e consulte os relatórios de conclusão.",
        "Os cartões de especialistas mantêm visíveis as tarefas enviadas com sucesso e incluem links para seus detalhes.",
        "Melhora títulos de sessões fixadas, menus de modelos e a descoberta opcional de skills.",
        "Orienta agentes padrão a delegar trabalhos importantes e líderes de equipes especialistas a atribuí-los a especialistas.",
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
