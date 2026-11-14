import type { ChangelogEntry, ChangelogLocale } from "./changelog.js";

/** Keep the upstream catalogs intact while preserving Plus's visible history. */
export const PLUS_UPSTREAM_CUTOFF = "0.15.6";

const plusEntries: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: [
    {
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "The Goal report now opens on a short first screen with only the Result (verdict, up to three key figures and what the Host verified) and the Next steps. The summary, execution record, evidence and limitations moved into one collapsed Full report, which also lists every metric. Small text is darker in the light theme.",
        "The report now shows active working time instead of the span from start to finish, so time spent waiting for you is no longer included; the Full report lists the total and the waiting time separately. A file reference that the Host does not check now reads “not checked by the host” instead of showing the warning used for a missing record.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "External controllers can now show why a Goal is blocked, continue the same Goal with supplemental material, or explicitly accept the current result. Acceptance keeps unmet checks and is recorded as user-confirmed, not verified completion.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "Fix in-app updates that stopped at “Restart to update” when a background crash-reporting helper from an earlier launch was still running: the update helper no longer waits for that reporter before replacing the app, while other app processes still block the swap.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "A task dispatched into a new worktree of a project whose main checkout was archived now appears in the sidebar with its project. Archive visibility follows the checkouts a sidebar row keeps open, so archiving any open checkout still hides that row.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "Unsigned macOS builds can now update in place. With automatic updates turned on, the app downloads the new release from this project's GitHub page, checks its SHA-512 and size, and installs it when you click Restart to update, keeping one backup of the previous app. Manual stays the default, and the first install of this version is still a manual download.",
        "The Updates settings explain why an install cannot update itself (a temporary, read-only or non-writable location) and offer Try again and the release link after a failed install. The checksum comes from the same release, so it detects corruption but is not an independent signature.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "Goal reports now verify each check on the Host: for Goals without approved verification commands, the check's command is matched against the Goal's own Bash runs, and the last finished run decides passed or failed instead of relying on the model to cite evidence.",
        "A check that no finished run settles stays inconclusive and says why. Results are recorded on the report only; whether a report can complete is unchanged.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "Keep unsigned macOS builds on manual update delivery: Check for Updates reports the new version and opens the release page instead of downloading an installer macOS cannot validate.",
        "Developer ID-signed builds keep automatic in-app updates; Windows and Linux update behavior is unchanged.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "Recover session history after interrupted writes and finish pending checkpoints before session settlement or shutdown.",
        "Preserve parent-session provider signatures and image/MCP tool results when resuming parent or delegated sessions.",
        "Recover malformed tool calls on Continue while preserving saved conversation history.",
        "Include cached input in runtime context budgets and keep retry backoff outside each provider attempt's stream-idle timeout.",
        "Prevent plugin commands from replacing another owner's entry and improve git-apply failure detection.",
        "Avoid duplicate slashes when using a Chinese input method.",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "目标报告现在首屏只显示“结果”（判定、最多三项关键数字，以及 Host 核验了什么）和“下一步”。摘要、执行记录、证据与限制收进了默认折叠的“完整报告”，其中也列出全部指标；浅色主题下的小字更深。",
        "报告现在显示实际工作时间，而不是从开始到结束的跨度，等待你的时间不再计入；“完整报告”里会分别列出总时长和等待时间。Host 不核验的文件引用现在显示“主机不核验”，不再沿用缺失记录的警告。",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "外部调度台现在可以显示目标受阻原因，补充材料后继续同一目标，或明确接受当前结果。接受现状会保留未通过项，并记录为用户确认结束，不会冒充验证通过。",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "修复应用内更新在「重启以更新」处失败的问题：此前从更早一次启动遗留的崩溃上报助手仍在运行时，更新助手会一直等待它；现在不再等待该助手，其他应用进程仍会阻止替换。",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "派发到已归档项目的新工作树中的任务，现在会和所属项目一起显示在侧边栏。归档可见性改为跟随侧边栏行保持打开的检出，因此归档任一打开的检出仍会隐藏该行。",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "未签名的 macOS 版本现在可以在应用内就地更新。开启自动更新后，应用会从本项目的 GitHub 发布页下载新版本，校验 SHA-512 与大小，并在你点击“重启以更新”时完成安装，同时保留一份旧版本备份。默认仍为手动更新，本版本的首次安装仍需手动下载。",
        "更新设置会说明无法就地更新的原因（临时位置、只读位置或不可写位置），安装失败后提供“重试”和发布页链接。校验值来自同一个发布，只能发现文件损坏，不是独立签名。",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "目标报告现在由 Host 核对每项检查：对没有已批准验证命令的目标，会把检查命令与该目标自己的 Bash 运行记录匹配，以最后一次已完成的运行判定通过或失败，不再依赖模型引用证据。",
        "没有任何已完成运行能判定的检查会保持“无法确定”并说明原因。结果只记录在报告上，不影响报告能否完成。",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "未签名 macOS 版本改为手动更新：检查更新会提示新版本并打开发布页，不再下载 macOS 无法校验的安装包。",
        "Developer ID 签名的版本仍自动应用内更新；Windows 和 Linux 的更新行为不变。",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "写入中断后仍可恢复会话历史，回合结束或关闭前完成待写入的检查点。",
        "保留主会话的提供商签名，并在主会话或委派会话恢复时保留图片和 MCP 工具结果。",
        "点击继续可恢复异常工具调用，同时保留已保存的会话历史。",
        "运行时上下文预算计入缓存输入，重试退避时间不再计入每次请求的流空闲超时。",
        "插件命令不能覆盖其他所有者的条目，Git Apply 失败识别更准确。",
        "使用中文输入法输入斜杠时不再重复。",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "目標報告現在首屏只顯示「結果」（判定、最多三項關鍵數字，以及 Host 核驗了什麼）和「下一步」。摘要、執行記錄、證據與限制收進預設摺疊的「完整報告」，其中也列出全部指標；淺色主題下的小字更深。",
        "報告現在顯示實際工作時間，而不是從開始到結束的跨度，等待你的時間不再計入；「完整報告」會分別列出總時間與等待時間。Host 不核驗的檔案引用現在顯示「主機不核驗」，不再沿用遺失記錄的警告。",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "外部調度台現在可以顯示目標受阻原因，補充資料後繼續同一目標，或明確接受目前結果。接受現況會保留未通過項目，並記錄為使用者確認結束，不會冒充驗證通過。",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "修正應用程式內更新在「重新啟動以更新」處失敗的問題：先前從更早一次啟動遺留的當機回報助手仍在執行時，更新助手會一直等待它；現在不再等待該助手，其他應用程式行程仍會阻止替換。",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "派發到已封存專案的新工作樹中的任務，現在會和所屬專案一起顯示在側邊欄。封存可見性改為跟隨側邊欄列保持開啟的檢出，因此封存任一開啟的檢出仍會隱藏該列。",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "未簽署的 macOS 版本現在可以在應用程式內就地更新。開啟自動更新後，應用程式會從本專案的 GitHub 頁面下載新版本，驗證 SHA-512 與大小，並在你按下「重啟以更新」時完成安裝，同時保留一份舊版本備份。預設仍為手動更新，本版本的首次安裝仍需手動下載。",
        "更新設定會說明無法就地更新的原因（暫時位置、唯讀位置或不可寫入的位置），安裝失敗後提供「重試」與發行頁連結。檢查碼來自同一個發行版本，只能發現檔案損毀，並非獨立簽章。",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "目標報告現在由 Host 核對每項檢查：對沒有已核准驗證指令的目標，會將檢查指令與該目標自己的 Bash 執行記錄比對，以最後一次已完成的執行判定通過或失敗，不再依賴模型引用證據。",
        "沒有任何已完成的執行能判定的檢查會維持「無法確定」並說明原因。結果只記錄在報告上，不影響報告能否完成。",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "未簽署 macOS 版本改為手動更新：檢查更新會回報新版本並打開發佈頁，不再下載 macOS 無法驗證的安裝套件。",
        "Developer ID 簽署的版本仍自動於應用程式內更新；Windows 與 Linux 的更新行為不變。",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "寫入中斷後仍可復原工作階段歷史，回合結束或關閉前完成待寫入的檢查點。",
        "保留主工作階段的供應商簽章，並在主工作階段或委派工作階段恢復時保留圖片和 MCP 工具結果。",
        "按下繼續可復原異常工具呼叫，同時保留已儲存的工作階段歷史。",
        "執行階段的上下文預算計入快取輸入，重試退避時間不再計入每次請求的串流閒置逾時。",
        "外掛指令無法覆蓋其他擁有者的項目，Git Apply 失敗辨識更準確。",
        "使用中文輸入法輸入斜線時不再重複。",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "Hedef raporu artık yalnızca “Sonuç” (karar, en fazla üç temel rakam ve Host’un neyi doğruladığı) ile “Sonraki adımlar” gösteren kısa bir ilk ekranla açılıyor. Özet, çalıştırma kaydı, kanıtlar ve sınırlamalar, tüm metrikleri de listeleyen ve kapalı gelen tek bir “Tam rapor” bölümüne taşındı. Açık temada küçük metinler daha koyu.",
        "Rapor artık başlangıçtan bitişe geçen süre yerine etkin çalışma süresini gösteriyor; sizi beklerken geçen süre dahil edilmiyor ve “Tam rapor” toplam ve bekleme süresini ayrı ayrı listeliyor. Host tarafından denetlenmeyen bir dosya başvurusu da eksik bir kayıt için verilen uyarı yerine “ana makine tarafından denetlenmez” olarak gösteriliyor.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "Harici denetleyiciler artık bir Hedefin neden engellendiğini gösterebilir, ek bilgilerle aynı Hedefi sürdürebilir veya mevcut sonucu açıkça kabul edebilir. Kabul, karşılanmayan kontrolleri korur ve doğrulanmış tamamlanma değil, kullanıcı onayı olarak kaydedilir.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "Daha önceki bir açılıştan kalan arka plan çökme raporlayıcısı hâlâ çalışırken „Güncellemek için yeniden başlat“ adımında takılan uygulama içi güncellemeler düzeltildi: güncelleme yardımcısı artık bu raporlayıcıyı beklemiyor; diğer uygulama süreçleri değiştirmeyi yine engelliyor.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "Arşivlenmiş bir projenin yeni çalışma ağacına gönderilen görevler artık projeleriyle birlikte kenar çubuğunda görünür. Arşiv görünürlüğü, kenar çubuğu satırının açık tuttuğu çalışma kopyalarını izler; açık bir kopyayı arşivlemek satırı yine gizler.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "İmzasız macOS sürümleri artık uygulama içinde yerinde güncellenebilir. Otomatik güncellemeler açıkken uygulama yeni sürümü bu projenin GitHub sayfasından indirir, SHA-512 değerini ve boyutunu doğrular ve “Güncellemek için yeniden başlat” düğmesine tıkladığınızda kurar; önceki uygulamanın bir yedeğini saklar. Varsayılan hâlâ elle güncellemedir ve bu sürümün ilk kurulumu yine elle indirilir.",
        "Güncelleme ayarları, bir kurulumun neden kendini güncelleyemediğini (geçici, salt okunur veya yazılamayan bir konum) açıklar ve kurulum başarısız olursa “Yeniden dene” ile sürüm bağlantısını sunar. Sağlama değeri aynı sürümden geldiği için bozulmayı yakalar ancak bağımsız bir imza değildir.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "Hedef raporları artık her kontrolü Host üzerinde doğrular: onaylı doğrulama komutu olmayan hedeflerde kontrolün komutu hedefin kendi Bash çalıştırmalarıyla eşleştirilir; modelin kanıt göstermesine güvenmek yerine son tamamlanan çalıştırma geçti veya kaldı kararını verir.",
        "Hiçbir tamamlanmış çalıştırmanın karara bağlayamadığı kontrol belirsiz kalır ve nedenini belirtir. Sonuçlar yalnızca rapora kaydedilir; bir raporun tamamlanıp tamamlanamayacağı değişmez.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "İmzasız macOS sürümleri artık manuel güncelleme kullanır: Güncellemeleri denetle yeni sürümü bildirir ve macOS'un doğrulayamadığı bir yükleyiciyi indirmek yerine sürüm sayfasını açar.",
        "Developer ID ile imzalanmış sürümler otomatik uygulama içi güncellemeyi korur; Windows ve Linux güncelleme davranışı değişmez.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "Kesintiye uğrayan yazmalardan sonra oturum geçmişini kurtarın; tur tamamlanmadan veya uygulama kapanmadan bekleyen kontrol noktalarını kaydedin.",
        "Ana oturumun sağlayıcı imzalarını, ana veya devredilen oturumlar sürdürülürken görsel ve MCP araç sonuçlarını koruyun.",
        "Kaydedilmiş konuşma geçmişini koruyarak Devam ile hatalı araç çağrılarından kurtulun.",
        "Çalışma zamanı bağlam bütçeleri önbellekteki girdiyi içerir; yeniden deneme beklemesi her sağlayıcı denemesinin akış boşta kalma süresine dahil edilmez.",
        "Eklenti komutlarının başka bir sahibin kaydını değiştirmesi engellenir ve git-apply hata tespiti iyileştirilir.",
        "Çince giriş yöntemi kullanılırken eğik çizginin yinelenmesi önlenir.",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "Der Zielbericht öffnet sich jetzt mit einer kurzen ersten Ansicht, die nur „Ergebnis“ (Bewertung, bis zu drei Kennzahlen und was der Host geprüft hat) und „Nächste Schritte“ zeigt. Zusammenfassung, Ausführungsprotokoll, Belege und Einschränkungen stehen in einem eingeklappten Bereich „Vollständiger Bericht“, der auch alle Kennzahlen auflistet. Kleiner Text ist im hellen Design dunkler.",
        "Der Bericht zeigt jetzt die aktive Arbeitszeit statt der Spanne vom Start bis zum Ende, sodass Wartezeit auf Sie nicht mehr eingerechnet wird; „Vollständiger Bericht“ führt Gesamt- und Wartezeit getrennt auf. Ein Dateiverweis, den der Host nicht prüft, lautet jetzt „vom Host nicht geprüft“, statt die Warnung für einen fehlenden Eintrag zu zeigen.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "Externe Steuerungen können jetzt anzeigen, warum ein Ziel blockiert ist, dasselbe Ziel mit ergänzendem Material fortsetzen oder das aktuelle Ergebnis ausdrücklich akzeptieren. Dabei bleiben unerfüllte Prüfungen erhalten; der Abschluss wird als vom Nutzer bestätigt und nicht als verifiziert erfasst.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "In-App-Updates, die bei „Zum Aktualisieren neu starten“ hängen blieben, weil ein Hintergrund-Crashmelder einer früheren Sitzung noch lief, werden repariert: Der Update-Helfer wartet nicht mehr auf diesen Melder; andere App-Prozesse blockieren den Austausch weiterhin.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "Aufgaben, die in einen neuen Arbeitsbaum eines archivierten Projekts gesendet werden, erscheinen jetzt mit ihrem Projekt in der Seitenleiste. Die Archivsichtbarkeit folgt den Checkouts, die eine Zeile der Seitenleiste geöffnet hält; das Archivieren eines geöffneten Checkouts blendet die Zeile weiterhin aus.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "Nicht signierte macOS-Builds lassen sich jetzt direkt in der App aktualisieren. Bei aktivierten automatischen Updates lädt die App die neue Version von der GitHub-Seite dieses Projekts herunter, prüft SHA-512 und Größe und installiert sie, sobald Sie auf „Zum Aktualisieren neu starten“ klicken; eine Sicherung der vorherigen App bleibt erhalten. Standard bleibt die manuelle Aktualisierung, und die erste Installation dieser Version erfolgt weiterhin manuell.",
        "Die Update-Einstellungen erklären, warum eine Installation sich nicht selbst aktualisieren kann (temporärer, schreibgeschützter oder nicht beschreibbarer Speicherort), und bieten nach einer fehlgeschlagenen Installation „Erneut versuchen“ sowie den Link zur Version an. Die Prüfsumme stammt aus demselben Release, erkennt also Beschädigungen, ist aber keine unabhängige Signatur.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "Zielberichte prüfen jede Prüfung jetzt auf dem Host: Bei Zielen ohne genehmigte Prüfbefehle wird der Befehl der Prüfung mit den eigenen Bash-Läufen des Ziels abgeglichen, und der letzte abgeschlossene Lauf entscheidet über bestanden oder fehlgeschlagen, statt sich darauf zu verlassen, dass das Modell Belege nennt.",
        "Eine Prüfung, die kein abgeschlossener Lauf entscheidet, bleibt unbestimmt und nennt den Grund. Ergebnisse werden nur im Bericht festgehalten; ob ein Bericht abgeschlossen werden kann, bleibt unverändert.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "Nicht signierte macOS-Builds verwenden jetzt manuelle Updates: Die Update-Prüfung meldet die neue Version und öffnet die Release-Seite, statt einen Installer herunterzuladen, den macOS nicht validieren kann.",
        "Mit Developer ID signierte Builds behalten automatische In-App-Updates; das Update-Verhalten unter Windows und Linux bleibt unverändert.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "Sitzungsverläufe nach unterbrochenen Schreibvorgängen wiederherstellen und ausstehende Prüfpunkte vor Rundenende oder Herunterfahren speichern.",
        "Anbietersignaturen der Hauptsitzung sowie Bild- und MCP-Werkzeugergebnisse beim Fortsetzen von Haupt- oder delegierten Sitzungen erhalten.",
        "Mit Fortsetzen fehlerhafte Werkzeugaufrufe beheben und dabei den gespeicherten Gesprächsverlauf erhalten.",
        "Zwischengespeicherte Eingaben im Laufzeit-Kontextbudget berücksichtigen; Wartezeiten vor Wiederholungen zählen nicht zum Stream-Leerlaufzeitlimit des jeweiligen Anbieterversuchs.",
        "Plugin-Befehle können keine Einträge anderer Eigentümer ersetzen; die Erkennung von git-apply-Fehlern wird verbessert.",
        "Doppelte Schrägstriche bei chinesischen Eingabemethoden vermeiden.",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "El informe del objetivo ahora se abre con una primera pantalla breve que solo muestra “Resultado” (veredicto, hasta tres cifras clave y lo que el Host verificó) y “Próximos pasos”. El resumen, el registro de ejecución, las evidencias y las limitaciones pasaron a una sección plegada, “Informe completo”, que también lista todas las métricas. El texto pequeño es más oscuro en el tema claro.",
        "El informe ahora muestra el tiempo de trabajo activo en lugar del lapso entre el inicio y el final, de modo que la espera de una respuesta del usuario ya no se cuenta; “Informe completo” indica por separado el total y la espera. Una referencia de archivo que el Host no comprueba ahora dice “no verificada por el host” en lugar de mostrar la advertencia de un registro ausente.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "Los controladores externos ahora pueden mostrar por qué un objetivo está bloqueado, continuar el mismo objetivo con material adicional o aceptar explícitamente el resultado actual. La aceptación conserva las comprobaciones pendientes y se registra como confirmación del usuario, no como finalización verificada.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "Se corrigieron las actualizaciones en la app que se detenían en «Reiniciar para actualizar» cuando seguía en ejecución un notificador de fallos de un inicio anterior: el asistente de actualización ya no espera a ese notificador; otros procesos de la app siguen bloqueando el intercambio.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "Las tareas enviadas a un nuevo árbol de trabajo de un proyecto archivado ahora aparecen en la barra lateral con su proyecto. La visibilidad del archivo sigue los checkouts que una fila mantiene abiertos, así que archivar un checkout abierto sigue ocultando la fila.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "Las compilaciones de macOS sin firmar ahora pueden actualizarse en el propio lugar desde la aplicación. Con las actualizaciones automáticas activadas, la aplicación descarga la nueva versión desde la página de GitHub de este proyecto, comprueba su SHA-512 y su tamaño, y la instala cuando se pulsa «Reiniciar para actualizar», conservando una copia de seguridad de la aplicación anterior. La opción predeterminada sigue siendo la actualización manual y la primera instalación de esta versión se sigue haciendo a mano.",
        "Los ajustes de actualización explican por qué una instalación no puede actualizarse sola (ubicación temporal, de solo lectura o sin permiso de escritura) y ofrecen «Reintentar» y el enlace de la versión tras una instalación fallida. La suma de comprobación procede de la misma versión, por lo que detecta daños, pero no es una firma independiente.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "Los informes de objetivos ahora verifican cada comprobación en el Host: en los objetivos sin comandos de verificación aprobados, el comando de la comprobación se compara con las ejecuciones de Bash del propio objetivo, y la última ejecución terminada decide si pasó o falló en lugar de depender de que el modelo cite evidencias.",
        "Una comprobación que ninguna ejecución terminada resuelve queda como no concluyente e indica el motivo. Los resultados solo se registran en el informe; que un informe pueda completarse no cambia.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "Las compilaciones de macOS sin firma usan ahora actualizaciones manuales: Buscar actualizaciones muestra la nueva versión y abre la página de versiones en lugar de descargar un instalador que macOS no puede validar.",
        "Las compilaciones firmadas con Developer ID conservan las actualizaciones automáticas dentro de la app; el comportamiento en Windows y Linux no cambia.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "Recupera el historial tras escrituras interrumpidas y guarda los puntos de control pendientes antes de finalizar el turno o cerrar.",
        "Conserva las firmas del proveedor de la sesión principal y los resultados de imágenes y herramientas MCP al reanudar sesiones principales o delegadas.",
        "Continuar recupera las llamadas a herramientas mal formadas sin alterar el historial guardado.",
        "El presupuesto de contexto incluye la entrada en caché; la espera entre reintentos no cuenta para el tiempo de inactividad del flujo de cada intento del proveedor.",
        "Los comandos de complementos no pueden reemplazar entradas de otros propietarios y mejora la detección de errores de git-apply.",
        "Evita barras duplicadas al usar un método de entrada chino.",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "Le rapport d’objectif s’ouvre désormais sur un court premier écran qui montre seulement « Résultat » (verdict, jusqu’à trois chiffres clés et ce que l’hôte a vérifié) et « Étapes suivantes ». Le résumé, le journal d’exécution, les preuves et les limites sont regroupés dans une section repliée, « Rapport complet », qui liste aussi toutes les métriques. Le petit texte est plus foncé dans le thème clair.",
        "Le rapport affiche maintenant le temps de travail actif plutôt que l’intervalle entre le début et la fin : l’attente d’une réponse de l’utilisateur n’est plus comptée, et « Rapport complet » indique séparément la durée totale et l’attente. Une référence de fichier que l’hôte ne vérifie pas indique désormais « non vérifiée par l’hôte » au lieu de l’avertissement d’un enregistrement manquant.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "Les contrôleurs externes peuvent désormais afficher pourquoi un objectif est bloqué, poursuivre ce même objectif avec des éléments complémentaires ou accepter explicitement le résultat actuel. Les vérifications non satisfaites sont conservées et la clôture est notée comme confirmée par l’utilisateur, et non comme vérifiée.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "Les mises à jour dans l'application qui restaient bloquées sur « Redémarrer pour mettre à jour » parce qu'un rapporteur de plantage d'un lancement précédent tournait encore sont corrigées : l'assistant de mise à jour n'attend plus ce rapporteur ; les autres processus de l'application bloquent toujours l'échange.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "Les tâches envoyées dans un nouvel arbre de travail d'un projet archivé apparaissent désormais dans la barre latérale avec leur projet. La visibilité de l'archive suit les checkouts qu'une ligne garde ouverts ; archiver un checkout ouvert masque toujours la ligne.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "Les versions macOS non signées peuvent désormais se mettre à jour sur place depuis l'application. Lorsque les mises à jour automatiques sont activées, l'application télécharge la nouvelle version depuis la page GitHub du projet, vérifie son SHA-512 et sa taille, puis l'installe quand vous cliquez sur « Redémarrer pour mettre à jour », en conservant une sauvegarde de l'application précédente. Le mode manuel reste le choix par défaut, et la première installation de cette version reste manuelle.",
        "Les réglages de mise à jour expliquent pourquoi une installation ne peut pas se mettre à jour d'elle-même (emplacement temporaire, en lecture seule ou non modifiable) et proposent « Réessayer » ainsi que le lien de la version après un échec d'installation. La somme de contrôle provient de la même version : elle détecte une corruption, mais n'est pas une signature indépendante.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "Les rapports d'objectifs vérifient désormais chaque contrôle sur l'hôte : pour les objectifs sans commandes de vérification approuvées, la commande du contrôle est rapprochée des exécutions Bash propres à l'objectif, et la dernière exécution terminée décide de la réussite ou de l'échec au lieu de dépendre des preuves citées par le modèle.",
        "Un contrôle qu'aucune exécution terminée ne tranche reste non concluant et en indique la raison. Les résultats sont uniquement consignés dans le rapport ; la possibilité de terminer un rapport ne change pas.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "Les versions macOS non signées utilisent désormais les mises à jour manuelles : la recherche de mises à jour annonce la nouvelle version et ouvre la page des versions au lieu de télécharger un installeur que macOS ne peut pas valider.",
        "Les versions signées avec un Developer ID conservent les mises à jour automatiques intégrées ; le comportement sous Windows et Linux reste inchangé.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "Récupérez l’historique après une écriture interrompue et enregistrez les points de contrôle en attente avant la fin du tour ou la fermeture.",
        "Conservez les signatures du fournisseur de la session principale ainsi que les images et résultats d’outils MCP lors de la reprise des sessions principales ou déléguées.",
        "Continuer permet de récupérer les appels d’outils mal formés tout en préservant l’historique enregistré.",
        "Le budget de contexte inclut les entrées en cache ; l’attente entre les tentatives ne compte pas dans le délai d’inactivité du flux de chaque tentative du fournisseur.",
        "Les commandes des extensions ne peuvent plus remplacer les entrées d’un autre propriétaire et la détection des échecs de git-apply est améliorée.",
        "Évite les barres obliques en double avec une méthode de saisie chinoise.",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "목표 보고서는 이제 “결과”(판정, 최대 세 가지 핵심 수치, Host가 확인한 내용)와 “다음 단계”만 보이는 짧은 첫 화면으로 열립니다. 요약, 실행 기록, 증거, 제한 사항은 기본으로 접힌 “전체 보고서”에 모였고, 모든 지표도 여기에서 볼 수 있습니다. 밝은 테마의 작은 글씨는 더 진해졌습니다.",
        "보고서는 이제 시작부터 끝까지의 경과 시간 대신 실제 작업 시간을 보여 주므로 사용자를 기다린 시간은 포함되지 않으며, “전체 보고서”에는 전체 시간과 대기 시간이 따로 표시됩니다. Host가 확인하지 않는 파일 참조는 누락된 기록에 쓰는 경고 대신 “호스트가 확인하지 않음”으로 표시됩니다.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "외부 제어 도구에서 목표가 차단된 이유를 확인하고, 추가 자료로 같은 목표를 계속하거나 현재 결과를 명시적으로 수락할 수 있습니다. 수락해도 미충족 검사는 유지되며 검증 완료가 아닌 사용자 확인 종료로 기록됩니다.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "이전 실행에서 남은 백그라운드 충돌 보고 도우미가 실행 중일 때 “업데이트를 위해 재시작”에서 멈추던 앱 내 업데이트를 수정했습니다. 이제 업데이트 도우미가 해당 보고 도우미를 기다리지 않으며, 다른 앱 프로세스는 계속 교체를 차단합니다.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "보관된 프로젝트의 새 작업 트리로 전달된 작업이 이제 프로젝트와 함께 사이드바에 표시됩니다. 보관 표시 여부는 사이드바 행이 열어 둔 체크아웃을 따르므로, 열린 체크아웃을 보관하면 해당 행은 계속 숨겨집니다.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "서명되지 않은 macOS 빌드도 이제 앱 안에서 제자리 업데이트할 수 있습니다. 자동 업데이트를 켜면 앱이 이 프로젝트의 GitHub 페이지에서 새 버전을 내려받아 SHA-512와 크기를 확인하고, ‘다시 시작하여 업데이트’를 누르면 설치하며 이전 앱의 백업을 하나 남깁니다. 기본값은 여전히 수동 업데이트이며, 이 버전의 첫 설치는 계속 직접 내려받아야 합니다.",
        "업데이트 설정은 설치가 스스로 업데이트할 수 없는 이유(임시, 읽기 전용 또는 쓰기 불가 위치)를 설명하고, 설치에 실패하면 ‘다시 시도’와 릴리스 링크를 제공합니다. 체크섬은 같은 릴리스에서 오므로 손상은 감지하지만 독립적인 서명은 아닙니다.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "목표 보고서가 이제 각 검사를 Host에서 확인합니다. 승인된 검증 명령이 없는 목표는 검사 명령을 해당 목표의 Bash 실행 기록과 대조하며, 모델이 증거를 인용하는 데 의존하지 않고 마지막으로 끝난 실행이 통과 또는 실패를 결정합니다.",
        "끝난 실행으로 판정되지 않는 검사는 판단 불가로 남고 그 이유를 표시합니다. 결과는 보고서에만 기록되며 보고서를 완료할 수 있는지는 달라지지 않습니다.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "서명되지 않은 macOS 빌드는 이제 수동 업데이트를 사용합니다. 업데이트 확인은 새 버전을 알리고 macOS가 검증할 수 없는 설치 프로그램을 다운로드하는 대신 릴리스 페이지를 엽니다.",
        "Developer ID로 서명된 빌드는 자동 인앱 업데이트를 유지하며 Windows와 Linux의 업데이트 동작은 변경되지 않습니다.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "쓰기 중단 후에도 세션 기록을 복구하고, 턴 종료나 앱 종료 전에 대기 중인 체크포인트를 저장합니다.",
        "기본 세션의 공급자 서명을 보존하고, 기본 또는 위임 세션을 재개할 때 이미지와 MCP 도구 결과를 유지합니다.",
        "계속을 누르면 저장된 대화 기록을 유지하면서 잘못된 도구 호출을 복구합니다.",
        "런타임 컨텍스트 예산에 캐시된 입력을 포함하고, 재시도 대기 시간은 각 공급자 시도의 스트림 유휴 제한 시간에서 제외합니다.",
        "플러그인 명령이 다른 소유자의 항목을 덮어쓰지 못하도록 하고 git-apply 실패 감지를 개선합니다.",
        "중국어 입력기 사용 시 슬래시가 중복 입력되는 문제를 방지합니다.",
      ],
    },
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
      version: "0.15.18",
      date: "2026-11-14",
      highlights: [
        "O relatório de meta agora abre em uma primeira tela curta, só com “Resultado” (veredicto, até três números-chave e o que o Host verificou) e “Próximos passos”. O resumo, o registro de execução, as evidências e as limitações foram para uma seção recolhida, “Relatório completo”, que também lista todas as métricas. O texto pequeno ficou mais escuro no tema claro.",
        "O relatório agora mostra o tempo de trabalho ativo em vez do intervalo entre o início e o fim, então a espera por uma resposta do usuário não é mais contada; o “Relatório completo” lista o total e a espera separadamente. Uma referência de arquivo que o Host não verifica agora diz “não verificada pelo host”, em vez de mostrar o aviso de um registro ausente.",
      ],
    },
    {
      version: "0.15.17",
      date: "2026-11-12",
      highlights: [
        "Controladores externos agora podem mostrar por que um objetivo está bloqueado, continuar o mesmo objetivo com material adicional ou aceitar explicitamente o resultado atual. A aceitação preserva as verificações não atendidas e é registrada como confirmação do usuário, não como conclusão verificada.",
      ],
    },
    {
      version: "0.15.16",
      date: "2026-11-10",
      highlights: [
        "Corrigidas as atualizações no aplicativo que paravam em “Reiniciar para atualizar” quando um relator de falhas de uma execução anterior ainda estava em execução: o assistente de atualização não espera mais por esse relator; outros processos do aplicativo continuam bloqueando a troca.",
      ],
    },
    {
      version: "0.15.15",
      date: "2026-11-10",
      highlights: [
        "Tarefas enviadas para uma nova árvore de trabalho de um projeto arquivado agora aparecem na barra lateral com seu projeto. A visibilidade do arquivo segue os checkouts que uma linha mantém abertos; arquivar um checkout aberto ainda oculta a linha.",
      ],
    },
    {
      version: "0.15.14",
      date: "2026-11-09",
      highlights: [
        "As versões do macOS sem assinatura agora podem ser atualizadas no próprio aplicativo. Com as atualizações automáticas ativadas, o aplicativo baixa a nova versão da página do GitHub deste projeto, confere o SHA-512 e o tamanho e a instala quando você clica em “Reiniciar para atualizar”, mantendo uma cópia de segurança do aplicativo anterior. O padrão continua sendo a atualização manual, e a primeira instalação desta versão ainda é feita manualmente.",
        "As configurações de atualização explicam por que uma instalação não consegue se atualizar sozinha (local temporário, somente leitura ou sem permissão de escrita) e oferecem “Tentar novamente” e o link da versão após uma instalação com falha. O checksum vem da mesma versão, então detecta corrupção, mas não é uma assinatura independente.",
      ],
    },
    {
      version: "0.15.13",
      date: "2026-11-08",
      highlights: [
        "Os relatórios de meta agora verificam cada checagem no Host: em metas sem comandos de verificação aprovados, o comando da checagem é comparado com as execuções de Bash da própria meta, e a última execução concluída decide se passou ou falhou, em vez de depender de o modelo citar evidências.",
        "Uma checagem que nenhuma execução concluída resolve continua inconclusiva e informa o motivo. Os resultados ficam registrados apenas no relatório; a possibilidade de concluir um relatório não muda.",
      ],
    },
    {
      version: "0.15.12",
      date: "2026-11-02",
      highlights: [
        "Builds de macOS sem assinatura agora usam atualizações manuais: Verificar atualizações informa a nova versão e abre a página de versões em vez de baixar um instalador que o macOS não consegue validar.",
        "Builds assinados com Developer ID mantêm as atualizações automáticas no aplicativo; o comportamento no Windows e Linux não muda.",
      ],
    },
    {
      version: "0.15.11",
      date: "2026-11-01",
      highlights: [
        "Recupere o histórico após gravações interrompidas e salve os pontos de controle pendentes antes de encerrar o turno ou o aplicativo.",
        "Preserve as assinaturas do provedor da sessão principal e os resultados de imagens e ferramentas MCP ao retomar sessões principais ou delegadas.",
        "Continuar recupera chamadas de ferramentas malformadas sem alterar o histórico salvo.",
        "O orçamento de contexto inclui entradas em cache; a espera entre tentativas não conta para o limite de inatividade do fluxo de cada tentativa do provedor.",
        "Comandos de plugins não podem substituir entradas de outros proprietários e a detecção de falhas do git-apply foi aprimorada.",
        "Evita barras duplicadas ao usar um método de entrada chinês.",
      ],
    },
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
