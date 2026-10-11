import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Bound expert-team runs with adjustable six-hour wrap-up and ten-hour safe-pause limits; retain the current run budget across pauses and restarts without killing background processes.",
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
        "专家团默认 6 小时提醒收尾、10 小时安全暂停，可在设置调整；暂停和重启保留当前周期预算，不主动停止后台进程。",
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
        "專家團預設 6 小時提醒收尾、10 小時安全暫停，可在設定調整；暫停與重啟保留目前週期預算，不主動停止背景程序。",
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
        "Uzman ekiplerde ayarlanabilir sınırlar: altı saatte tamamlama uyarısı, on saatte güvenli duraklatma; duraklatma ve yeniden başlatma süreyi korur, arka plan süreçlerini durdurmaz.",
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
        "Experten-Teams erhalten einstellbare Grenzen: Abschluss nach sechs Stunden, sichere Pause nach zehn Stunden; Pausen und Neustarts behalten das Zeitbudget, Hintergrundprozesse laufen weiter.",
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
        "Los equipos expertos tienen límites ajustables: aviso de cierre a las seis horas y pausa segura a las diez; las pausas y los reinicios conservan el tiempo y los procesos en segundo plano siguen activos.",
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
        "Les équipes ont des limites réglables : rappel de conclusion après six heures et pause sûre après dix ; les pauses et redémarrages conservent le temps, sans arrêter les processus en arrière-plan.",
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
        "전문가 팀에 조정 가능한 실행 제한을 추가했습니다. 기본 6시간 후 마무리 알림, 10시간 후 안전하게 일시 중지하며 재시작해도 실행 시간을 유지하고 백그라운드 프로세스는 종료하지 않습니다.",
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
        "Equipes têm limites ajustáveis: aviso de conclusão após seis horas e pausa segura após dez; pausas e reinícios preservam o tempo, sem encerrar processos em segundo plano.",
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
