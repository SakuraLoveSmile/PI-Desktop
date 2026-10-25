import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "Fix macOS app launch failures caused by a missing resource seal by completing ad-hoc signing after packaging.",
        "Verify app and Host signatures inside the actual ZIP and DMG before publishing.",
        "Personal-use macOS Apple Silicon builds remain unnotarized and require manual download and installation.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "Find exact settings with direct search results and a searchable category chooser in narrow windows; filter shortcuts and project memory.",
        "Keep editor actions reachable, retain failed-save drafts for retry, distinguish saved settings from refresh failures, and expand optional skill discovery only when needed.",
        "Bind required verification commands to Goals and accept completion only with durable, successful shell evidence from the same execution; show concrete progress statuses.",
        "Keep Stop within one ten-second cancellation window even when a tool and its cancellation both stop responding, and isolate late results from the next turn.",
        "Correct long-session output budgets and compaction retries, omit genuinely empty saved replies, and preserve AskTool drafts across chats.",
        "Open positioned file links precisely, reject ambiguous file names, and exclude expired system trust anchors while retaining certificate and hostname verification.",
        "Improve the Composer workspace strip, queue controls, thinking labels, Plan exit and context usage; keep Overview file changes and expert statuses clear, and dismiss menus on user scrolling.",
        "Keep session lists responsive and pin recovery windows only on macOS.",
        "Goal verification upgrades local profiles to Plus schema P10 with a migration backup. Older builds cannot reopen an upgraded profile; restore the preserved pre-upgrade profile before downgrading.",
      ],
    },
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
        "Leave Plan mode from the Composer's Plan chip with its close control, keeping the plan history.",
        "Label the context meter Remaining or Used to match the context display setting.",
        "Give the Agent profile its own single-person icon, so it reads apart from the model chip.",
      ],
    },
  ],
  "zh-CN": [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "修复 macOS 应用因缺少资源封装而无法启动的问题，打包后完成 ad-hoc 签名。",
        "发布前校验实际 ZIP 和 DMG 内应用及 Host 的签名。",
        "个人使用的 macOS Apple Silicon 版本仍未经公证，需手动下载和安装。",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "设置搜索可直达具体设置项；窄窗口提供可搜索的分类目录，快捷键和项目记忆支持筛选。",
        "编辑器操作保持可见；保存失败保留草稿供重试，区分保存成功与刷新失败，技能发现仅在展开时扫描。",
        "目标可绑定必验命令，仅接受同次执行中已持久化且成功的 Shell 证据，并展示具体进度状态。",
        "即使工具执行和取消请求都无响应，停止操作也在同一个十秒取消窗口内收敛，迟到结果不会影响下一回合。",
        "修复长会话输出额度与压缩后的重试，不再保存无内容的空回复，切换会话保留提问草稿。",
        "文件链接准确跳转到指定位置，同名歧义不再猜测打开；排除过期系统信任证书并保留证书与主机名校验。",
        "改进输入区工作区条、队列、思考标签、规划退出和上下文用量；概要清晰展示文件变化与专家状态，用户滚动时关闭菜单。",
        "减少会话列表重复计算，恢复窗口仅在 macOS 保持置顶。",
        "目标验证会将本地档案升级为 Plus P10，并保留迁移备份。旧版无法重开升级后的档案；降级前须恢复保留的升级前档案。",
      ],
    },
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
        "规划芯片新增关闭控件，可直接返回 Agent 模式，并保留规划历史。",
        "上下文量表标签随显示设置标明剩余或已用。",
        "智能体配置使用单人图标并更名为单智能体，与模型芯片区分开。",
      ],
    },
  ],
  "zh-TW": [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "修正 macOS 應用程式因缺少資源封裝而無法啟動的問題，封裝後完成 ad-hoc 簽名。",
        "發佈前驗證實際 ZIP 和 DMG 內應用程式及 Host 的簽名。",
        "個人使用的 macOS Apple Silicon 版本仍未經公證，需手動下載與安裝。",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "設定搜尋可直接前往具體設定項；窄視窗提供可搜尋的分類目錄，快速鍵和專案記憶支援篩選。",
        "編輯器操作保持可見；儲存失敗保留草稿供重試，區分儲存成功與重新整理失敗，技能探索僅在展開時掃描。",
        "目標可綁定必驗指令，僅接受同次執行中已持久儲存且成功的 Shell 證據，並顯示具體進度狀態。",
        "即使工具執行和取消請求都無回應，停止操作也在同一個十秒取消視窗內完成收斂，延遲結果不會影響下一回合。",
        "修正長工作階段輸出額度與壓縮後的重試，不再儲存無內容的空回覆，切換工作階段保留提問草稿。",
        "檔案連結準確跳至指定位置，同名歧義不再猜測開啟；排除過期系統信任憑證並保留憑證與主機名稱驗證。",
        "改進輸入區工作區列、佇列、思考標籤、規劃退出與上下文用量；概要清楚顯示檔案變更與專家狀態，使用者捲動時關閉選單。",
        "減少工作階段清單重複計算，復原視窗僅在 macOS 保持置頂。",
        "目標驗證會將本機設定檔升級為 Plus P10，並保留遷移備份。舊版無法重新開啟升級後的設定檔；降級前須還原保留的升級前設定檔。",
      ],
    },
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
        "規劃晶片新增關閉控制，可直接返回 Agent 模式，並保留規劃歷史。",
        "上下文量表標籤依顯示設定標示剩餘或已用。",
        "智能體設定改用單人圖示，與模型晶片區分開。",
      ],
    },
  ],
  tr: [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "Paketleme sonrasında ad-hoc imzalamayı tamamlayarak eksik kaynak mühründen kaynaklanan macOS açılış hatalarını düzeltir.",
        "Yayımlamadan önce gerçek ZIP ve DMG içindeki uygulama ve Host imzalarını doğrular.",
        "Kişisel kullanım için macOS Apple Silicon derlemeleri noter onaysız kalır; elle indirme ve kurulum gerekir.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "Ayar araması doğrudan ilgili satıra gider; dar pencerelerde aranabilir kategori seçici, kısayol ve proje belleği filtreleri sunulur.",
        "Düzenleyici eylemleri erişilebilir kalır, kaydetme hataları taslakları korur, kaydetme ile yenileme hataları ayrılır ve isteğe bağlı beceri keşfi yalnızca açıldığında tarar.",
        "Hedeflere zorunlu doğrulama komutları bağlayın; tamamlanma yalnızca aynı yürütmeden kalıcı, başarılı kabuk kanıtlarıyla kabul edilir ve somut ilerleme durumları gösterilir.",
        "Araç ve iptal isteği yanıt vermese bile Durdur tek bir on saniyelik iptal penceresinde tamamlanır; geç gelen sonuçlar sonraki turu etkilemez.",
        "Uzun oturumlarda çıktı sınırları ve sıkıştırma sonrası yeniden denemeler düzeltilir, boş yanıtlar kaydedilmez ve sohbetler arasında soru taslakları korunur.",
        "Dosya bağlantıları doğru konumu açar ve belirsiz adları reddeder; sertifika ve ana makine doğrulaması korunarak süresi dolmuş sistem güven sertifikaları dışlanır.",
        "Çalışma alanı çubuğu, kuyruk, düşünme etiketleri, Plan çıkışı ve bağlam kullanımı iyileştirilir; Genel Bakış dosya değişikliklerini ve uzman durumlarını gösterir, kullanıcı kaydırdığında menüler kapanır.",
        "Oturum listelerinde yinelenen hesaplamalar azaltılır; kurtarma pencereleri yalnızca macOS üzerinde üstte tutulur.",
        "Hedef doğrulama, geçiş yedeğiyle yerel profilleri Plus P10 şemasına yükseltir. Eski derlemeler yükseltilmiş profilleri açamaz; sürüm düşürmeden önce korunmuş eski profili geri yükleyin.",
      ],
    },
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
        "Composer'daki Plan çipinin kapat denetimiyle Plan modundan çıkın; plan geçmişi korunur.",
        "Bağlam ölçeri, görüntüleme ayarına göre Kalan veya Kullanılan olarak etiketlenir.",
        "Ajan profiline tek kişilik bir simge verilerek model çipinden ayrışması sağlandı.",
      ],
    },
  ],
  de: [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "Behebt macOS-Startfehler durch fehlende Ressourcenversiegelung mit vollständiger Ad-hoc-Signierung nach dem Paketieren.",
        "Prüft vor der Veröffentlichung die Signaturen von App und Host in den tatsächlichen ZIP- und DMG-Dateien.",
        "macOS-Apple-Silicon-Builds für den persönlichen Gebrauch bleiben ohne Notarisierung und erfordern manuellen Download und Installation.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "Die Einstellungssuche führt direkt zum passenden Eintrag; schmale Fenster erhalten eine durchsuchbare Kategorienauswahl, Tastenkürzel und Projektgedächtnis eigene Filter.",
        "Editoraktionen bleiben erreichbar, fehlgeschlagene Speichervorgänge behalten Entwürfe, Speicher- und Aktualisierungsfehler bleiben unterscheidbar und die optionale Skill-Suche startet erst beim Aufklappen.",
        "Ziele können Pflichtprüfbefehle binden und werden nur mit dauerhaft gespeicherten, erfolgreichen Shell-Nachweisen derselben Ausführung abgeschlossen; konkrete Fortschrittszustände werden angezeigt.",
        "Stopp endet innerhalb eines gemeinsamen Zehn-Sekunden-Fensters, auch wenn Werkzeug und Abbruch nicht antworten; verspätete Ergebnisse beeinflussen den nächsten Durchlauf nicht.",
        "Ausgabebudgets und Wiederholungen nach Komprimierung bleiben korrekt, leere Antworten werden nicht gespeichert und Frageentwürfe bleiben beim Chatwechsel erhalten.",
        "Dateilinks öffnen die genaue Position und lehnen mehrdeutige Namen ab; abgelaufene Systemzertifikate werden bei weiterhin aktiver Zertifikats- und Hostnamenprüfung ausgeschlossen.",
        "Verbesserungen für Arbeitsbereichsleiste, Warteschlange, Denkstufen, Plan-Ausstieg und Kontextverbrauch; die Übersicht zeigt Dateiänderungen und Expertenzustände, Menüs schließen beim bewussten Scrollen.",
        "Sitzungslisten vermeiden wiederholte Berechnungen; Wiederherstellungsfenster bleiben nur unter macOS im Vordergrund.",
        "Die Zielprüfung aktualisiert lokale Profile mit Migrationssicherung auf Plus-Schema P10. Ältere Builds können diese Profile nicht öffnen; vor einem Downgrade das gesicherte frühere Profil wiederherstellen.",
      ],
    },
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
        "Verlasse den Plan-Modus über die Schließen-Schaltfläche am Plan-Chip des Composers; der Planverlauf bleibt erhalten.",
        "Die Kontextanzeige nennt Verbleibend oder Verwendet entsprechend der Anzeigeeinstellung.",
        "Das Agenten-Profil erhält ein eigenes Einzelpersonen-Symbol und unterscheidet sich so vom Modell-Chip.",
      ],
    },
  ],
  es: [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "Corrige fallos de inicio en macOS por un sellado de recursos ausente al completar la firma ad hoc después del empaquetado.",
        "Verifica las firmas de la aplicación y de Host dentro de los ZIP y DMG reales antes de publicar.",
        "Las compilaciones personales de macOS para Apple Silicon siguen sin notarizarse y requieren descarga e instalación manuales.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "La búsqueda abre el ajuste exacto; las ventanas estrechas ofrecen categorías con búsqueda y filtros para atajos y memoria del proyecto.",
        "Las acciones de edición siguen accesibles, los fallos de guardado conservan borradores, se distinguen de los fallos de actualización y el descubrimiento opcional de habilidades solo explora al desplegarse.",
        "Vincula comandos de verificación obligatorios a los objetivos y acepta su finalización solo con pruebas de shell duraderas y correctas de la misma ejecución; muestra estados de progreso concretos.",
        "Detener termina dentro de una única ventana de cancelación de diez segundos aunque la herramienta y su cancelación no respondan; los resultados tardíos no afectan al siguiente turno.",
        "Corrige presupuestos de salida y reintentos tras compactar sesiones largas, omite respuestas vacías guardadas y conserva borradores de preguntas al cambiar de chat.",
        "Los enlaces abren la posición exacta y rechazan nombres ambiguos; se excluyen certificados del sistema caducados manteniendo la verificación de certificados y nombres de host.",
        "Mejora la barra del espacio de trabajo, la cola, las etiquetas de razonamiento, la salida de Plan y el uso de contexto; la vista general muestra cambios y estados de expertos, y los menús se cierran al desplazarse.",
        "Evita cálculos repetidos en las listas de sesiones y mantiene las ventanas de recuperación en primer plano solo en macOS.",
        "La verificación de objetivos actualiza los perfiles locales al esquema Plus P10 con copia de migración. Las versiones anteriores no pueden abrirlos; restaura el perfil previo conservado antes de volver a una versión anterior.",
      ],
    },
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
        "Sal del modo Plan con el botón de cierre del chip Plan del Composer; el historial del plan se conserva.",
        "El medidor de contexto indica Restante o Usado según la preferencia de visualización.",
        "El perfil de agente tiene su propio icono de persona, para distinguirlo del chip del modelo.",
      ],
    },
  ],
  fr: [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "Corrige les échecs de lancement sur macOS dus à un scellement des ressources absent en terminant la signature ad hoc après la création du paquet.",
        "Vérifie les signatures de l’application et de Host dans les véritables archives ZIP et DMG avant publication.",
        "Les versions macOS Apple Silicon à usage personnel restent non notarisées et nécessitent un téléchargement et une installation manuels.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "La recherche ouvre le réglage exact ; les fenêtres étroites proposent des catégories recherchables et des filtres pour les raccourcis et la mémoire du projet.",
        "Les actions restent accessibles, les échecs de sauvegarde conservent les brouillons, se distinguent des échecs de rafraîchissement et la découverte facultative des compétences ne démarre qu’au dépliage.",
        "Associez des commandes de vérification obligatoires aux objectifs ; leur achèvement exige des preuves shell durables et réussies de la même exécution, avec des états de progression précis.",
        "L’arrêt se termine dans une seule fenêtre d’annulation de dix secondes même si l’outil et son annulation ne répondent plus ; les résultats tardifs restent isolés du tour suivant.",
        "Corrige les budgets de sortie et les nouvelles tentatives après compactage, évite les réponses vides sauvegardées et conserve les brouillons de questions entre les discussions.",
        "Les liens de fichiers ouvrent la position exacte et refusent les noms ambigus ; les certificats système expirés sont exclus sans désactiver la vérification des certificats et des noms d’hôte.",
        "Améliore la barre d’espace de travail, la file, les niveaux de réflexion, la sortie du mode Plan et l’usage du contexte ; la vue d’ensemble précise les changements et les états des experts, et les menus se ferment au défilement volontaire.",
        "Évite les recalculs des listes de sessions et garde les fenêtres de récupération au premier plan uniquement sous macOS.",
        "La vérification des objectifs migre les profils locaux vers le schéma Plus P10 avec sauvegarde. Les anciennes versions ne peuvent pas les rouvrir ; restaurez le profil précédent conservé avant toute rétrogradation.",
      ],
    },
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
        "Quittez le mode Plan avec le bouton de fermeture du repère Plan du Composer ; l'historique du plan est conservé.",
        "La jauge de contexte affiche Restant ou Utilisé selon le réglage d'affichage.",
        "Le profil Agent reçoit sa propre icône de personne, pour se distinguer du repère du modèle.",
      ],
    },
  ],
  ko: [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "패키징 후 ad-hoc 서명을 완료하여 리소스 봉인 누락으로 발생하던 macOS 앱 실행 실패를 수정합니다.",
        "게시 전에 실제 ZIP과 DMG 안의 앱 및 Host 서명을 검증합니다.",
        "개인용 macOS Apple Silicon 빌드는 여전히 공증되지 않으며 수동 다운로드와 설치가 필요합니다.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "설정 검색에서 정확한 항목으로 바로 이동하며, 좁은 창에서는 검색 가능한 분류 선택기와 단축키·프로젝트 메모리 필터를 제공합니다.",
        "편집기 작업 버튼을 계속 사용할 수 있고 저장 실패 시 초안을 유지합니다. 저장과 새로 고침 실패를 구분하며 선택적 스킬 검색은 펼칠 때만 시작합니다.",
        "목표에 필수 검증 명령을 연결하고 같은 실행에서 영구 저장된 성공한 셸 증거가 있어야 완료를 인정하며 구체적인 진행 상태를 표시합니다.",
        "도구 실행과 취소 요청이 모두 응답하지 않아도 하나의 10초 취소 시간 안에 중지를 마치고 늦은 결과가 다음 턴에 영향을 주지 않게 합니다.",
        "긴 세션의 출력 한도와 압축 후 재시도를 수정하고 빈 응답을 저장하지 않으며 채팅 간 질문 초안을 유지합니다.",
        "파일 링크가 정확한 위치를 열고 모호한 이름은 거부하며 인증서와 호스트 이름 검증을 유지한 채 만료된 시스템 신뢰 인증서를 제외합니다.",
        "입력창의 작업 공간 표시줄, 대기열, 사고 수준, 계획 종료와 컨텍스트 사용량을 개선합니다. 개요는 파일 변경과 전문가 상태를 표시하고 사용자 스크롤 시 메뉴를 닫습니다.",
        "세션 목록의 반복 계산을 줄이고 복구 창은 macOS에서만 맨 위에 유지합니다.",
        "목표 검증은 마이그레이션 백업을 남기고 로컬 프로필을 Plus P10으로 업그레이드합니다. 이전 빌드는 업그레이드된 프로필을 열 수 없으므로 다운그레이드 전에 보관된 이전 프로필을 복원해야 합니다.",
      ],
    },
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
        "Composer의 계획 칩 닫기 버튼으로 계획 모드를 종료하며 계획 기록은 유지됩니다.",
        "컨텍스트 미터 라벨이 표시 설정에 맞춰 남음 또는 사용됨을 표시합니다.",
        "에이전트 프로필에 단일 사용자 아이콘을 부여해 모델 칩과 구분합니다.",
      ],
    },
  ],
  "pt-BR": [
    {
      version: "0.15.10",
      date: "2026-10-25",
      highlights: [
        "Corrige falhas de inicialização no macOS causadas pela ausência do selo de recursos, concluindo a assinatura ad hoc após o empacotamento.",
        "Verifica as assinaturas do aplicativo e do Host nos arquivos ZIP e DMG reais antes da publicação.",
        "As compilações pessoais do macOS para Apple Silicon continuam sem notarização e exigem download e instalação manuais.",
      ],
    },
    {
      version: "0.15.9",
      date: "2026-10-24",
      highlights: [
        "A busca abre a configuração exata; janelas estreitas oferecem categorias pesquisáveis e filtros para atalhos e memória do projeto.",
        "As ações dos editores continuam acessíveis, falhas ao salvar preservam rascunhos, diferem de falhas de atualização e a descoberta opcional de habilidades só verifica ao ser expandida.",
        "Vincule comandos de verificação obrigatórios às metas e aceite a conclusão apenas com evidências de shell persistidas e bem-sucedidas da mesma execução; veja estados concretos de progresso.",
        "Parar termina em uma única janela de cancelamento de dez segundos mesmo quando a ferramenta e seu cancelamento não respondem; resultados tardios não afetam o próximo turno.",
        "Corrige limites de saída e novas tentativas após compactar sessões longas, evita respostas vazias salvas e mantém rascunhos de perguntas entre conversas.",
        "Links de arquivos abrem a posição exata e rejeitam nomes ambíguos; certificados de sistema expirados são excluídos mantendo a verificação de certificados e nomes de host.",
        "Melhora a barra do espaço de trabalho, a fila, os níveis de raciocínio, a saída de Plan e o uso de contexto; a visão geral exibe alterações e estados dos especialistas, e menus fecham ao rolar manualmente.",
        "Evita cálculos repetidos nas listas de sessões e mantém janelas de recuperação no topo apenas no macOS.",
        "A verificação de metas atualiza perfis locais para o esquema Plus P10 com backup de migração. Versões antigas não podem reabri-los; restaure o perfil anterior preservado antes de voltar a uma versão antiga.",
      ],
    },
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
        "Saia do modo Plano pelo botão de fechar no chip Plano do Composer, mantendo o histórico do plano.",
        "O medidor de contexto mostra Restante ou Usado conforme a configuração de exibição.",
        "O perfil Agente recebe ícone de pessoa única, distinguindo-o do chip do modelo.",
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
