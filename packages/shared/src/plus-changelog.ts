import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "Download macOS Apple Silicon builds from GitHub Releases. Personal unsigned builds use manual installation and updates.",
        "Installers are built in GitHub Actions and published with verified checksums and update metadata.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Keep long-session output budgets and retries correct after instruction updates and compaction; omit genuinely empty replies from saved history.",
        "Preserve AskTool drafts across chats and open positioned file links precisely, rejecting ambiguous file names.",
        "Exclude expired system trust anchors while retaining certificate and hostname verification.",
        "Keep unmet Goals blocked with preserved progress; continue the same contract, accept the current result explicitly, or abandon it.",
        "Show queued expert-report metadata during Lead turns, protect active members with reasoned interruption, retire stale task dispatches and warn about shared-tree Git commands without blocking them.",
        "Keep Team Lead questions answerable after a thirty-minute pause, and replace a failed approved expert once while retaining its permissions and history.",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "可从 GitHub Releases 下载 macOS Apple Silicon 版本；个人使用的未签名版本需手动安装和更新。",
        "安装包通过 GitHub Actions 云端构建，并附带经过校验的文件摘要和更新元数据。",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "修复长会话指令更新、压缩后的输出额度与重试，历史记录不再保存无内容的空回复。",
        "切换会话保留提问草稿；文件链接准确跳转到指定行，同名歧义不再猜测打开。",
        "合并系统信任证书时排除已过期项，并保留证书与主机名校验。",
        "未达成的目标会保留进度并进入受阻；可沿用同一契约继续执行、明确接受现状或放弃。",
        "Lead 回合可见待处理专家报告摘要；中断活跃成员需要明确理由，未开始的过期任务派发会撤销，共享树 Git 操作仅警告、不拦截。",
        "团队 Lead 问题等待 30 分钟后释放回合但保留可回答卡片；失败的已批准专家可替换一次，继承原权限并保留历史。",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "可從 GitHub Releases 下載 macOS Apple Silicon 版本；個人使用的未簽名版本需手動安裝與更新。",
        "安裝套件透過 GitHub Actions 雲端建置，並附上經過驗證的檔案雜湊與更新中繼資料。",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "修正長工作階段指令更新、壓縮後的輸出額度與重試，歷史記錄不再儲存無內容的空回覆。",
        "切換工作階段保留提問草稿；檔案連結準確跳至指定行，同名歧義不再猜測開啟。",
        "合併系統信任憑證時排除已過期項，並保留憑證與主機名稱驗證。",
        "未達成的目標會保留進度並進入受阻；可沿用同一契約繼續執行、明確接受現況或放棄。",
        "Lead 回合可見待處理專家報告摘要；中斷活躍成員需要明確理由，未開始的過期任務派發會撤銷，共用樹 Git 操作僅警告、不攔截。",
        "團隊 Lead 問題等待 30 分鐘後釋放回合但保留可回答卡片；失敗的已核准專家可替換一次，繼承原權限並保留歷史。",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "macOS Apple Silicon derlemelerini GitHub Releases üzerinden indirin. Kişisel imzasız derlemeler elle kurulur ve güncellenir.",
        "Kurulum paketleri GitHub Actions üzerinde derlenir ve doğrulanmış sağlama toplamları ile güncelleme meta verileriyle yayımlanır.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Uzun oturumlarda yönerge güncellemeleri ve sıkıştırma sonrası çıktı bütçesi ve yeniden denemeler düzeltildi; boş yanıtlar geçmişe kaydedilmez.",
        "Sohbetler arasında soru taslaklarını koruyun ve dosya bağlantılarında belirtilen satıra gidin; belirsiz dosya adları açılmaz.",
        "Süresi dolmuş sistem kök sertifikalarını dışlayın; sertifika ve ana makine doğrulaması korunur.",
        "Tamamlanmayan hedefler ilerlemeyi koruyarak engellenir; aynı sözleşmeyle devam edin, mevcut sonucu açıkça kabul edin veya vazgeçin.",
        "Lider turlarında bekleyen uzman raporlarını gösterir; etkin üyeleri gerekçeli kesintilerle korur, eski görev gönderimlerini iptal eder ve ortak Git işlemlerinde engellemeden uyarır.",
        "Ekip lideri soruları otuz dakika sonra turu serbest bırakır ve yanıtlanabilir kalır; başarısız onaylı uzman, izinleri ve geçmişi korunarak bir kez değiştirilebilir.",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "macOS-Builds für Apple Silicon sind über GitHub Releases verfügbar. Unsignierte Builds für den persönlichen Gebrauch werden manuell installiert und aktualisiert.",
        "Installationspakete werden in GitHub Actions erstellt und mit geprüften Prüfsummen und Update-Metadaten veröffentlicht.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Ausgabebudgets und Wiederholungen bleiben nach Anweisungsänderungen und Komprimierung korrekt; leere Antworten werden nicht gespeichert.",
        "Frageentwürfe bleiben beim Chatwechsel erhalten; Dateilinks öffnen die angegebene Zeile und mehrdeutige Namen bleiben ungeöffnet.",
        "Abgelaufene Systemzertifikate werden ausgeschlossen; Zertifikats- und Hostnamenprüfung bleiben aktiv.",
        "Nicht erreichte Ziele bleiben mit ihrem Fortschritt blockiert; denselben Auftrag fortsetzen, den aktuellen Stand ausdrücklich akzeptieren oder aufgeben.",
        "Zeigt ausstehende Expertenberichte im Lead-Durchlauf, schützt aktive Mitglieder mit begründeten Unterbrechungen, verwirft veraltete Aufgaben und warnt bei gemeinsamem Git ohne Blockierung.",
        "Team-Lead-Fragen bleiben nach dreißig Minuten beantwortbar; ein fehlgeschlagener genehmigter Experte kann einmal mit bestehenden Rechten und Verlauf ersetzt werden.",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "Descarga versiones para macOS Apple Silicon desde GitHub Releases. Las versiones personales sin firma se instalan y actualizan manualmente.",
        "Los instaladores se compilan en GitHub Actions y se publican con sumas de verificación y metadatos de actualización validados.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Corrige el presupuesto de salida y los reintentos tras actualizar instrucciones o compactar sesiones largas; omite respuestas vacías del historial.",
        "Conserva borradores de preguntas al cambiar de chat y abre enlaces en la línea indicada; los nombres ambiguos no se abren.",
        "Excluye certificados del sistema caducados y mantiene la verificación de certificados y nombres de host.",
        "Los objetivos no alcanzados quedan bloqueados conservando su progreso; continúe el mismo contrato, acepte explícitamente el resultado actual o abandone.",
        "Muestra informes pendientes al Lead, protege miembros activos con interrupciones justificadas, retira tareas obsoletas y advierte sobre Git compartido sin bloquear.",
        "Las preguntas del Lead liberan el turno tras treinta minutos y siguen disponibles; un experto aprobado que falle puede sustituirse una vez conservando permisos e historial.",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "Téléchargez les versions macOS Apple Silicon depuis GitHub Releases. Les versions personnelles non signées s’installent et se mettent à jour manuellement.",
        "Les programmes d’installation sont compilés dans GitHub Actions et publiés avec des sommes de contrôle et des métadonnées de mise à jour vérifiées.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Corrige le budget de sortie et les reprises après modification des instructions ou compactage ; les réponses vides ne sont plus enregistrées.",
        "Conserve les brouillons de questions entre les discussions et ouvre les fichiers à la ligne indiquée, sans choisir un nom ambigu.",
        "Exclut les certificats système expirés tout en conservant la vérification des certificats et des noms d’hôte.",
        "Les objectifs non atteints restent bloqués avec leur progression ; poursuivez le même contrat, acceptez explicitement le résultat actuel ou abandonnez.",
        "Affiche les rapports en attente au Lead, protège les membres actifs par une interruption motivée, retire les tâches périmées et avertit pour Git partagé sans bloquer.",
        "Les questions du Lead libèrent le tour après trente minutes et restent accessibles ; un expert approuvé en échec peut être remplacé une fois en conservant droits et historique.",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "GitHub Releases에서 macOS Apple Silicon 빌드를 다운로드할 수 있습니다. 개인용 미서명 빌드는 수동으로 설치하고 업데이트합니다.",
        "설치 파일은 GitHub Actions에서 빌드되며 검증된 체크섬과 업데이트 메타데이터와 함께 게시됩니다.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "긴 세션의 지침 갱신과 압축 후 출력 한도 및 재시도를 수정하고 내용 없는 응답은 기록에 저장하지 않습니다.",
        "채팅을 전환해도 질문 초안을 유지하며 파일 링크의 지정 줄로 이동합니다. 모호한 파일 이름은 열지 않습니다.",
        "만료된 시스템 신뢰 인증서를 제외하고 인증서와 호스트 이름 검증을 유지합니다.",
        "달성하지 못한 목표는 진행 상황을 보존하고 차단됩니다. 같은 계약으로 계속하거나, 현재 결과를 명시적으로 수락하거나, 포기할 수 있습니다.",
        "Lead 실행 중 대기 중인 전문가 보고서 요약을 표시하고, 활성 구성원 중단에는 이유를 요구합니다. 오래된 작업 전달을 취소하고 공유 Git 명령은 차단 없이 경고합니다.",
        "팀 Lead 질문은 30분 후 실행을 해제해도 답변할 수 있습니다. 실패한 승인 전문가는 기존 권한과 기록을 유지하며 한 번 교체할 수 있습니다.",
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
      version: "0.15.8",
      date: "2026-10-24",
      highlights: [
        "Baixe versões para macOS Apple Silicon pelo GitHub Releases. Versões pessoais sem assinatura são instaladas e atualizadas manualmente.",
        "Os instaladores são compilados no GitHub Actions e publicados com somas de verificação e metadados de atualização validados.",
      ],
    },
    {
      version: "0.15.7",
      date: "2026-10-02",
      highlights: [
        "Corrige limites de saída e novas tentativas após atualizar instruções ou compactar sessões longas; respostas vazias não são salvas no histórico.",
        "Preserva rascunhos de perguntas ao trocar de conversa e abre arquivos na linha indicada; nomes ambíguos não são abertos.",
        "Exclui certificados de sistema expirados, mantendo a verificação de certificados e nomes de host.",
        "Metas não alcançadas ficam bloqueadas com o progresso preservado; continue o mesmo contrato, aceite explicitamente o resultado atual ou abandone.",
        "Mostra relatórios pendentes ao Lead, protege membros ativos com interrupção justificada, retira tarefas obsoletas e alerta sobre Git compartilhado sem bloquear.",
        "Perguntas do Lead liberam o turno após trinta minutos e continuam disponíveis; um especialista aprovado que falhar pode ser substituído uma vez, preservando permissões e histórico.",
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
