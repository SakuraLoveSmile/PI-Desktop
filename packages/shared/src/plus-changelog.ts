import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Use a two-line chat input that grows with the draft, and show follow-up and steering shortcuts while a run is active.",
        "Keep Overview outputs, references and delegated tasks complete across long sessions and restarts; reconcile Goal reports and expert task outcomes with recorded execution.",
        "Require Expert Team delegation for every task; launch read-only Plan research automatically while keeping execution roster approval.",
        "Track live progress for approved Goals and review their completion reports.",
        "Keep successful task dispatches visible in expert cards, with links to task details.",
        "Render Expert Team turns with dispatch cards as an inline chronological timeline.",
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
        "聊天输入区从两行开始并随草稿增高；执行中显示发送后续消息与立即转向的快捷键提示。",
        "概要在长会话和重启后仍保留产出、来源与委派任务；目标报告和专家任务结果会与记录的执行状态对账。",
        "专家团所有任务都需委派专家；规划自动启动只读研究，执行名单仍需用户批准。",
        "跟踪已批准目标的实时进度，并查看完成报告。",
        "专家任务卡片会保留成功派发的状态，并链接到任务详情。",
        "专家团回合在派发卡片所在位置按时间顺序展示内容。",
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
        "聊天輸入區從兩行開始並隨草稿增高；執行中顯示傳送後續訊息與立即轉向的快捷鍵提示。",
        "概要在長工作階段與重新啟動後仍保留產出、來源與委派任務；目標報告和專家任務結果會與記錄的執行狀態核對。",
        "專家團所有任務都需委派專家；規劃自動啟動唯讀研究，執行名單仍需使用者核准。",
        "追蹤已核准目標的即時進度，並檢視完成報告。",
        "專家任務卡片會保留成功派送的狀態，並連結至任務詳細資訊。",
        "專家團回合會在派送卡片所在位置依時間順序呈現內容。",
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
        "Sohbet girişi iki satırla başlar ve taslakla büyür; çalışma sırasında takip ve yönlendirme kısayollarını gösterir.",
        "Uzun oturumlarda ve yeniden başlatmada Genel Bakış çıktıları, kaynakları ve devredilen görevleri korur; hedef raporları ve uzman sonuçları kaydedilen yürütmeyle eşleştirilir.",
        "Uzman Ekipte her görev için yetki devri zorunludur; salt okunur Plan araştırması otomatik başlar, yürütme kadrosu onayı korunur.",
        "Onaylanan hedeflerin canlı ilerlemesini takip edin ve tamamlanma raporlarını görüntüleyin.",
        "Uzman görev kartlarında başarıyla gönderilen görevlerin durumunu koruyun ve görev ayrıntılarına bağlantı verin.",
        "Uzman Ekip turlarını, görev kartlarının bulunduğu konumlarda kronolojik sırayla görüntüleyin.",
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
        "Die Chateingabe beginnt mit zwei Zeilen und wächst mit dem Entwurf; laufende Aufgaben zeigen Tastenkürzel für Folgenachrichten und Umlenkung.",
        "Die Übersicht bewahrt Ergebnisse, Quellen und delegierte Aufgaben in langen Sitzungen und nach Neustarts; Zielberichte und Expertenresultate werden mit der aufgezeichneten Ausführung abgeglichen.",
        "Expertenteams delegieren jede Aufgabe; schreibgeschützte Plan-Recherche startet automatisch, das Ausführungsteam bleibt genehmigungspflichtig.",
        "Verfolgen Sie den Live-Fortschritt genehmigter Ziele und sehen Sie sich Abschlussberichte an.",
        "Erfolgreich verteilte Aufgaben bleiben in Expertenkarten sichtbar und sind mit den Aufgabendetails verknüpft.",
        "Expertenteam-Züge zeigen Inhalte an den Aufgabenkarten in chronologischer Reihenfolge.",
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
        "La entrada del chat comienza con dos líneas y crece con el borrador; durante la ejecución muestra atajos para seguimiento y redirección.",
        "La vista general conserva resultados, fuentes y tareas delegadas en sesiones largas y tras reinicios; los informes de objetivos y los resultados de expertos se concilian con la ejecución registrada.",
        "Los equipos de expertos delegan todas las tareas; la investigación de Plan de solo lectura se inicia automáticamente y el equipo de ejecución requiere aprobación.",
        "Sigue el progreso en directo de los objetivos aprobados y consulta sus informes de finalización.",
        "Las tarjetas de expertos conservan las tareas enviadas correctamente y enlazan a sus detalles.",
        "Muestra los turnos del equipo de expertos en orden cronológico junto a sus tarjetas de tareas.",
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
        "La saisie du chat commence sur deux lignes et grandit avec le brouillon ; pendant une exécution, elle indique les raccourcis de suivi et de réorientation.",
        "La vue d’ensemble conserve les résultats, sources et tâches déléguées dans les longues sessions et après redémarrage ; les rapports d’objectifs et résultats des experts sont rapprochés de l’exécution enregistrée.",
        "Les équipes d'experts délèguent chaque tâche ; la recherche Plan en lecture seule démarre automatiquement et l'équipe d'exécution reste soumise à approbation.",
        "Suivez la progression en direct des objectifs approuvés et consultez leurs rapports d'achèvement.",
        "Les cartes d'experts conservent les tâches distribuées avec succès et proposent un lien vers leurs détails.",
        "Affiche les tours de l'équipe d'experts dans l'ordre chronologique, au niveau des cartes de tâche.",
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
        "채팅 입력은 두 줄에서 시작해 초안과 함께 늘어나며, 실행 중에는 후속 메시지와 방향 전환 단축키를 표시합니다.",
        "긴 세션과 재시작 후에도 개요의 산출물, 출처, 위임 작업을 유지하며 목표 보고서와 전문가 결과를 기록된 실행 상태와 대조합니다.",
        "전문가 팀은 모든 작업을 위임합니다. Plan의 읽기 전용 연구는 자동으로 시작되며 실행 명단은 사용자 승인이 필요합니다.",
        "승인된 목표의 실시간 진행 상황을 추적하고 완료 보고서를 확인하세요.",
        "전문가 작업 카드에 성공적으로 전달된 작업 상태를 유지하고 작업 상세 정보로 연결합니다.",
        "전문가 팀 턴의 내용을 작업 카드 위치에 시간순으로 표시합니다.",
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
        "A entrada do chat começa com duas linhas e cresce com o rascunho; durante a execução mostra atalhos de acompanhamento e redirecionamento.",
        "A visão geral preserva resultados, fontes e tarefas delegadas em sessões longas e após reinícios; relatórios de objetivos e resultados de especialistas são conciliados com a execução registrada.",
        "Equipes de especialistas delegam todas as tarefas; a pesquisa somente leitura do Plan inicia automaticamente e a equipe de execução exige aprovação.",
        "Acompanhe o progresso em tempo real de metas aprovadas e consulte os relatórios de conclusão.",
        "Os cartões de especialistas mantêm visíveis as tarefas enviadas com sucesso e incluem links para seus detalhes.",
        "Exiba os turnos da Equipe de Especialistas em ordem cronológica junto aos cartões de tarefas.",
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
