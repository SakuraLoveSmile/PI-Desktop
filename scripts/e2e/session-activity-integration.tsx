import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "@pi-desktop/i18n";
import type { BackgroundProcessSummary, PlanProposal, SessionQuickNote, SessionSummary, UiMessage, ProviderPublic, ModelInfo } from "@pi-desktop/shared";
import { ChatSurface } from "../../apps/desktop/src/components/ChatSurface";
import { SubagentTranscriptTab } from "../../apps/desktop/src/components/workpanel/SubagentTranscriptTab";
import { Button } from "../../apps/desktop/src/components/ui";
import { OverviewTab } from "../../apps/desktop/src/components/workpanel/OverviewTab";
import { ScheduledEditor } from "../../apps/desktop/src/features/scheduled/ScheduledEditor";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { createTranscriptReadingRuntime } from "../../apps/desktop/src/stores/runtime/transcript-reading-runtime";
import { api } from "../../apps/desktop/src/lib/api";
import { slotRegistry } from "../../apps/desktop/src/plugins/renderer-slots/registry";
import { installFooterMenuFixture, type FooterScene } from "./session-activity/footer-menus";

declare global {
  var enableResponsiveComposerPreview: () => void;
  var composerDesignScene: (scene: 'default' | 'profile' | 'models' | 'subagent' | 'narrow' | 'context' | 'outputs' | 'skills' | 'skills-list' | FooterScene) => Promise<void>;
}

/** Real shell, retained panes and activity model; only the external Host edge is replaced. */
export async function sessionActivityIntegrationProbe() {
  const initial = useAppStore.getState();
  const theme = document.documentElement.getAttribute('data-theme');
  const i18n = createInstance();
  await i18n.init({lng:'zh-CN',interpolation:{escapeValue:false},resources:{'zh-CN':{translation:zhCN}}});
  const host=document.createElement('div');
  host.style.cssText='position:fixed;inset:0;z-index:1;background:var(--ds-bg-primary);width:1100px;height:760px;';
  document.body.append(host);
  const errors:unknown[]=[];
  const root=createRoot(host,{onUncaughtError:error=>errors.push(error)});
  const original={list:api.listBackgroundProcesses,read:api.readBackgroundProcess,stop:api.stopBackgroundProcess,changed:api.onBackgroundProcessesChanged,host:api.onHostStatus,getNote:api.getSessionQuickNote,saveNote:api.saveSessionQuickNote,shells:api.listCommandShells,configure:api.configureSession,models:api.listProviderModels,roster:api.getTeamRoster,pause:api.teamPause,abort:api.abort,prompt:api.prompt,snapshot:api.getTeamSnapshot,sessions:api.listSessions,compact:api.compact,createSkill:api.createUserSkill,goalProgress:api.getGoalProgress,goalReport:api.getGoalReport,progressChanged:api.onGoalProgressChanged,reportChanged:api.onGoalReportChanged,session:api.getSession,activity:api.getSessionActivity,activityChanged:api.onSessionActivityChanged};
  // This loaded-window fixture explicitly exercises the older Host fallback.
  // Complete canonical history has a separate native/Rust integration probe.
  api.getSessionActivity=async()=>{throw new Error('SESSION_ACTIVITY_UNSUPPORTED');};
  api.onSessionActivityChanged=()=>()=>{};
  const calls:string[]=[];
  const footerFixture=installFooterMenuFixture();
  const notes=new Map<string,SessionQuickNote>();
  const createdAt=new Date(Date.now()-17_000).toISOString();
  // Synthetic catalog metadata for layout only; never read a configured account.
  const models:ModelInfo[]=[{modelId:'qwen3.8-max',displayName:'Qwen3.8-Max',providerId:'preview-provider',contextWindow:262144,capabilities:['text','tools','reasoning','vision'],supportedThinkingLevels:['off','low','high','max'],source:'user'},{modelId:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',providerId:'preview-provider',contextWindow:200000,capabilities:['text','tools','reasoning'],supportedThinkingLevels:['off','low','high'],source:'user'}];
  const provider:ProviderPublic={id:'preview-provider',name:'预览模型（示例）',vendorKey:'custom',type:'custom',protocol:'openai',enabled:true,authKind:'none',hasSecret:false,models:models.map(model=>({id:model.modelId,alias:model.displayName,contextWindow:model.contextWindow??200000,maxTokens:8192,thinkingLevels:model.supportedThinkingLevels??['off'],defaultThinkingLevel:'off'})),defaultModelId:'qwen3.8-max',supportsReasoning:true,supportedThinkingLevels:['off','low','high','max'],createdAt,updatedAt:createdAt};
  api.listProviderModels=async()=>({models,source:'cache'});
  api.listSessions=async()=>({sessions:useAppStore.getState().sessions});
  api.configureSession=async(id,config)=>{calls.push(`configure:${id}`);const current=useAppStore.getState().sessions.find(item=>item.id===id);if(!current)throw new Error('Unknown preview session');return {session:{...current,...config}};};
  api.getTeamRoster=async teamSessionId=>({teamSessionId,revision:0,paused:false,members:[]});
  api.teamPause=async teamSessionId=>({team:{teamSessionId,paused:true}});
  api.getTeamSnapshot=async teamSessionId=>({teamSessionId,revision:0,paused:false,members:[],tasks:[],readiness:[],scopeOverlaps:[],leadPhase:'idle',queuedMessageCount:0,review:null,decision:null});
  api.abort=async()=>({ok:true});
  api.prompt=async()=>{throw new Error('Isolated preview does not run a model.');};
  api.compact=async request=>{calls.push(`compact:${request.sessionId}`);return {ok:true};};
  let job:BackgroundProcessSummary={id:'activity-job',sessionId:'activity-a',toolCallId:'activity-bash',command:'flutter analyze --no-pub',cwd:'/isolated/music',status:'running',startedAt:createdAt};
  api.listBackgroundProcesses=async sessionId=>{calls.push(`list:${sessionId}`);return {processes:job.sessionId===sessionId?[job]:[]};};
  api.readBackgroundProcess=async(sessionId,id)=>{calls.push(`read:${sessionId}:${id}`);return {process:job,stdout:'Analyzing music…',stderr:'',stdoutTruncated:false,stderrTruncated:false};};
  api.stopBackgroundProcess=async(sessionId,id)=>{calls.push(`stop:${sessionId}:${id}`);job={...job,status:'stopped'};return {process:job};};
  api.onBackgroundProcessesChanged=()=>()=>{};api.onHostStatus=()=>()=>{};
  api.listCommandShells=async()=>({configuredId:null,fallback:false,effective:{id:'bash',label:'Bash',dialect:'posix',available:true,isDefault:true},choices:[]});
  api.getSessionQuickNote=async sessionId=>{calls.push(`note:${sessionId}`);return {note:notes.get(sessionId)??{sessionId,content:'',revision:0}};};
  api.saveSessionQuickNote=async(sessionId,content,revision)=>{calls.push(`save:${sessionId}`);if((notes.get(sessionId)?.revision??0)!==revision)throw new Error('NOTE_CONFLICT');const note={sessionId,content,revision:revision+1,updatedAt:createdAt};notes.set(sessionId,note);return {note};};
  const msg=(id:string,role:UiMessage['role'],content:string,extra:Partial<UiMessage>={}):UiMessage=>({id,role,content,createdAt,...extra});
  const messages=[msg('activity-u','user','随机歌曲右侧按钮应随机新歌，而非直接播放。'),msg('activity-intro','assistant','我会先检查推荐卡片与缓存逻辑，确认换曲和播放的调用关系。'),msg('activity-read','tool','File contents',{toolName:'Read',toolStatus:'success',toolArgs:{path:'lib/core/providers.dart'}}),msg('activity-progress','assistant','已经找到原因：右侧按钮复用了播放操作。接下来会把随机换曲独立出来，并保留现有推荐缓存。'),msg('activity-before-task','tool','Random recommendation state',{toolName:'Read',toolStatus:'success',toolArgs:{path:'lib/core/random.dart'}}),msg('activity-task','tool','',{toolName:'Task',toolStatus:'success',toolCallId:'activity-call',toolArgs:{agent:'state-review',task:'检查推荐缓存与换曲状态'},toolResult:{details:{delegationId:'activity-delegate',status:'running'}}}),msg('activity-child-thinking','assistant','',{parentToolCallId:'activity-call',agentName:'state-review',thinking:'检查随机推荐缓存与播放队列是否共享状态。'}),msg('activity-child-read','tool','缓存仅在生成推荐时刷新，播放操作应保持独立。',{parentToolCallId:'activity-call',agentName:'state-review',toolName:'Read',toolStatus:'success',toolArgs:{path:'lib/core/recommendation.dart'}}),msg('activity-child-answer','assistant','建议将随机换曲调用与播放器启动分离，并在切换歌曲后保留推荐缓存。',{parentToolCallId:'activity-call',agentName:'state-review',status:'complete'}),msg('activity-wait','tool','State review completed',{toolName:'TaskWait',toolStatus:'success',toolArgs:{delegationId:'activity-delegate'},toolResult:{details:{status:'completed'}}}),msg('activity-text','assistant','子智能体正在核对状态边界，分析命令已在后台运行。你可以在右侧查看输出或停止进程。',{status:'complete'})];
  const second=[msg('activity-b-user','user','另一个会话的笔记与任务')];
  const session=(id:string,title:string):SessionSummary=>({id,title,mode:'agent',thinkingLevel:'off',permissionMode:'auto',createdAt,updatedAt:createdAt,messageCount:messages.length,source:'desktop',executionProfile:'standard',providerId:provider.id,modelId:'qwen3.8-max'});
  const plan:PlanProposal={id:'activity-plan',sessionId:'activity-a',turnId:'activity-turn',toolCallId:'activity-plan-call',kind:'plan',title:'随机歌曲按钮与缓存修复计划',markdown:'Plan',plan:'Plan',question:'',version:1,status:'approved',createdAt,updatedAt:createdAt};
  const set=(patch:Parameters<typeof useAppStore.setState>[0])=>flushSync(()=>useAppStore.setState(patch));
  set({workspace:{path:'/isolated/music',name:'PI-Desktop',branch:'main'},openProjects:[{path:'/isolated/music',name:'PI-Desktop',branch:'main'}],activeSessionId:'activity-a',retainedSessionIds:['activity-a','activity-b'],retainedTranscripts:{'activity-a':messages,'activity-b':second},messages,sessions:[{...session('activity-a','随机歌曲按钮修复'),projectPath:'/isolated/music'},session('activity-b','另一会话')],runningSessions:{'activity-a':true},isRunning:true,settings:{defaultMode:'agent',theme:'dark',thinkingDisplayMode:'compact',enterToSend:true,onboardingDismissed:true},planHistory:{'activity-a':[plan]},pendingPlans:{},planCheckpoints:{},pendingPermissions:{},pendingAsks:{},workPanelOpen:false,workPanelTabs:[],activeWorkPanelTabId:null,workPanelContexts:{},providers:[provider],providerModels:{},page:'chat'});
  const checks:string[]=[];const check=(value:unknown,name:string)=>{if(!value)throw new Error(name);checks.push(name);};
  async function until(predicate:()=>boolean,name:string){const end=performance.now()+5000;while(!predicate()){if(performance.now()>end)throw new Error(`${name}; session=${useAppStore.getState().activeSessionId}; activity=${host.querySelector('.chat-surface')?.getAttribute('data-activity-visible')}; calls=${calls.join(',')}; errors=${errors.map(String).join(';')}; visible=${host.textContent?.slice(-1000)}`);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}if(errors.length)throw new Error(errors.map(String).join(';'));}
  const click=(target:Element|null|undefined)=>{if(!(target instanceof HTMLElement))throw new Error(`Missing integration control; ${new Error().stack}; visible=${host.textContent?.slice(-800)}; menus=${[...document.querySelectorAll('.composer-footer-menu')].map(item=>item.textContent).join('|')}`);flushSync(()=>target.click());};
  const rail=()=>host.querySelector<HTMLElement>('.session-pane[data-visible="true"] .session-activity-rail:not([hidden])');
  function App(){const open=useAppStore(state=>state.workPanelOpen);const tab=useAppStore(state=>state.workPanelTabs.find(item=>item.id===state.activeWorkPanelTabId));return <I18nextProvider i18n={i18n}><div style={{height:'100%',display:'flex'}}><div className="main-pane"><ChatSurface /></div>{open&&<aside data-preview-panel style={{width:350,flexShrink:0,height:'100%',display:'flex',flexDirection:'column',background:'var(--ds-bg-primary)',borderLeft:'1px solid var(--ds-border-subtle)'}}><header style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:12}}><strong>{tab?.kind==='subagent'?'state-review':'运行概览'}</strong><Button variant="ghost" onClick={()=>set({workPanelOpen:false})}>关闭</Button></header><div style={{flex:1,minHeight:0,overflow:'auto'}}>{tab?.kind==='subagent'?<SubagentTranscriptTab delegationId={tab.resource}/>:<OverviewTab />}</div></aside>}</div></I18nextProvider>;}
  const cleanup=()=>{flushSync(()=>root.unmount());host.remove();footerFixture.restore();Object.assign(api,{listBackgroundProcesses:original.list,readBackgroundProcess:original.read,stopBackgroundProcess:original.stop,onBackgroundProcessesChanged:original.changed,onHostStatus:original.host,getSessionQuickNote:original.getNote,saveSessionQuickNote:original.saveNote,listCommandShells:original.shells,configureSession:original.configure,listProviderModels:original.models,getTeamRoster:original.roster,teamPause:original.pause,abort:original.abort,prompt:original.prompt,getTeamSnapshot:original.snapshot,listSessions:original.sessions,compact:original.compact,createUserSkill:original.createSkill,getGoalProgress:original.goalProgress,getGoalReport:original.goalReport,onGoalProgressChanged:original.progressChanged,onGoalReportChanged:original.reportChanged,getSession:original.session,getSessionActivity:original.activity,onSessionActivityChanged:original.activityChanged});useAppStore.setState(initial);if(theme===null)document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',theme);};
  try{
    document.documentElement.setAttribute('data-theme','dark');flushSync(()=>root.render(<App/>));
    await until(()=>host.querySelector('.chat-surface')?.getAttribute('data-activity-visible')==='true'&&rail()?.querySelector('.session-activity-command')?.textContent==='flutter','Wide pane activity did not load');
    check(!host.querySelector('.thinking-display-control')&&!host.querySelector('.transcript-display-toolbar'),'mode selector absent from conversation');
    check(calls.filter(item=>item.startsWith('list:')).every(item=>item==='list:activity-a'),'hidden retained pane does not read process state');
    check(Boolean(rail()?.textContent?.includes('state-review')),'recorded delegation appears in rail');
    check(getComputedStyle(rail()!.querySelector('.session-activity-row')!).display==='flex'&&Boolean(rail()?.querySelector('.session-activity-agent-glyph'))&&!rail()?.querySelector('.subagent-activity-avatar'),'actual lazy activity stylesheet is loaded');
    check(host.querySelector('.chat-session-main')!.getBoundingClientRect().right<=rail()!.getBoundingClientRect().left,'rail does not cover transcript');
    const visiblePane=host.querySelector('.session-pane[data-visible="true"]')!;
    const taskCard=visiblePane.querySelector('.subagent-tasks-card')!;const taskRow=taskCard?.querySelector('.subagent-tasks-row');
    check(!taskCard.querySelector('.subagent-tasks-action-btn')&&!taskCard.textContent?.includes('查看全景'),'subagent rows have no panorama entry');
    check(Boolean(taskRow&&!taskRow.closest('[hidden]')&&taskRow.getBoundingClientRect().height>0),'compact task row is visible by default');
    check(Math.abs(taskCard.getBoundingClientRect().width-taskCard.closest('.message-col')!.getBoundingClientRect().width)<=2,'compact task card fills reading column');
    check(visiblePane.querySelectorAll('.subagent-tasks-card').length===1,'mixed tool group displays one delegation card');
    const before=visiblePane.querySelector('[data-message-id="activity-before-task"]')?.closest('.process-activity-group');const after=visiblePane.querySelector('[data-message-id="activity-wait"]')?.closest('.process-activity-group');
    check(Boolean(before?.querySelector('.process-activity-body[hidden]')&&after?.querySelector('.process-activity-body[hidden]')),'ordinary tools around delegate stay collapsed');
    check(Boolean(before&&(before.compareDocumentPosition(taskCard)&Node.DOCUMENT_POSITION_FOLLOWING)&&after&&(taskCard.compareDocumentPosition(after)&Node.DOCUMENT_POSITION_FOLLOWING)),'Read Task TaskWait retain transcript order');
    click(taskRow);await until(()=>Boolean(host.querySelector('.subagent-transcript-tab')),'Task card did not open real delegate details');check(!host.querySelector('.subagent-transcript-tab textarea, .subagent-transcript-composer'),'task card opens delegate details without an input placeholder');set({workPanelOpen:false});await until(()=>Boolean(rail()),'Rail did not return after task card');
    check(!host.querySelector('.session-quick-notes')&&!calls.some(call=>call.startsWith('note:')||call.startsWith('save:')),'quick notes are not rendered or loaded');
    await until(()=>Boolean(rail()?.querySelector('[data-process-id="activity-job"]')),'Process snapshot did not refresh');
    click(rail()?.querySelector('[data-activity-group="processes"] .session-activity-disclosure'));
    check(rail()?.querySelector('[data-activity-group="processes"] .session-activity-disclosure')?.getAttribute('aria-expanded')==='false','running process group manually collapsed');
    click([...rail()!.querySelectorAll('button')].find(button=>button.querySelector('.session-activity-group-title')?.textContent==='子智能体'));
    set({activeSessionId:'activity-b',retainedSessionIds:['activity-b','activity-a'],messages:second,isRunning:false});await until(()=>rail()?.getAttribute('data-session-id')==='activity-b','Session B did not display');
    check(!rail()?.textContent?.includes('state-review'),'A tasks do not leak into B');
    check(!host.querySelector('.composer-workspace-context')?.textContent?.includes('main'),'pathless session does not borrow another project branch');
    const localSessions = useAppStore.getState().sessions;
    set({sessions:localSessions.map(item=>item.id==='activity-b'?{...item,source:'remote',projectPath:'/isolated/music',projectName:'Remote project'}:item)});
    check(host.querySelector('.composer-workspace-context')?.textContent?.includes('远程')&&!host.querySelector('.composer-workspace-context')?.textContent?.includes('main'),'remote project does not borrow a matching local branch');
    set({sessions:localSessions});

    set({activeSessionId:'activity-a',retainedSessionIds:['activity-a','activity-b'],messages,isRunning:true});await until(()=>rail()?.getAttribute('data-session-id')==='activity-a','Retained A did not return');
    await until(()=>rail()?.querySelector('[data-activity-group="processes"] .session-activity-group-count')?.textContent==='1','Returning process snapshot did not load');
    check(rail()?.querySelector('[data-activity-group="processes"] .session-activity-disclosure')?.getAttribute('aria-expanded')==='false','unchanged running process preserves manual collapse after hide/show');
    const heading=[...rail()!.querySelectorAll('button')].find(button=>button.querySelector('.session-activity-group-title')?.textContent==='子智能体')!;check(heading.getAttribute('aria-expanded')==='false','session switch preserves group disclosure');click(heading);
    click(rail()?.querySelector('[data-activity-id="activity-delegate"]'));check(useAppStore.getState().workPanelContexts['activity-a']?.tabs.some(tab=>tab.kind==='subagent'&&tab.resource==='activity-delegate'),'agent opens owning session tab');await until(()=>Boolean(host.querySelector('.subagent-transcript-tab')),'Real delegate transcript did not render');check(Boolean(host.querySelector('.subagent-transcript-tab')?.textContent?.includes('建议将随机换曲调用')),'delegate answer uses real transcript component');check(!host.querySelector('.subagent-transcript-tab textarea, .subagent-transcript-composer'),'delegate details have no input placeholder');check(host.querySelector('.composer-dock')!.getBoundingClientRect().right<=host.querySelector('[data-preview-panel]')!.getBoundingClientRect().left+1,'detail panel does not cover composer');
    set({workPanelOpen:false});await until(()=>Boolean(rail()),'Rail did not return');host.style.width='600px';await until(()=>host.querySelector('.chat-surface')?.getAttribute('data-activity-visible')==='false','Narrow pane did not release space');
    check(Boolean(host.querySelector('.session-activity-access')),'narrow pane exposes overview entry');click(host.querySelector('.session-activity-access'));await until(()=>Boolean(host.querySelector('.activity-overview-tab .session-activity-rail')),'Narrow activity panel unavailable');check(!host.querySelector('.activity-overview-tab .session-quick-notes'),'narrow activity panel has no quick notes');
    check(useAppStore.getState().workPanelTabs.find(tab=>tab.id===useAppStore.getState().activeWorkPanelTabId)?.resource==='activity','narrow entry opens activity tab');
    check(host.querySelector('.chat-surface')?.getAttribute('data-activity-visible')==='false','work panel takes priority over rail');
    host.style.width='1100px';set({workPanelOpen:false});await until(()=>Boolean(rail()),'Wide rail did not return');
    check(host.querySelector('.composer-dock')!.getBoundingClientRect().right<=rail()!.getBoundingClientRect().left+1,'composer remains inside reading region');check(host.scrollWidth<=host.clientWidth,'whole chat has no horizontal overflow');
    const editor=()=>host.querySelector<HTMLElement>('.composer-input');
    const input=(content:string)=>{const field=editor();if(!field)throw new Error('Missing composer editor');flushSync(()=>{field.textContent=content;field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:content}));});};
    check(Boolean(host.querySelector('.stop-btn')),'running empty draft retains stop');
    const stop = host.querySelector<HTMLElement>('.stop-btn')!;
    const stopBounds = stop.getBoundingClientRect();
    const stopRadius = getComputedStyle(stop).borderRadius;
    check(Math.abs(stopBounds.width - 32) < .5 && Math.abs(stopBounds.height - 32) < .5, 'stop is a 32 pixel rounded toolbar control');
    // Goal planning is running too: hide the redundant contract only after the
    // authoritative checkpoint enters execution, never from isRunning alone.
    const toolbarSessions = useAppStore.getState().sessions;
    api.getGoalProgress = async () => ({ progress: null });
    api.getGoalReport = async () => ({ state: 'pending', report: null });
    api.onGoalProgressChanged = () => () => {};
    api.onGoalReportChanged = () => () => {};
    set({ sessions: toolbarSessions.map(item => item.id === 'activity-a' ? { ...item, mode: 'goal' } : item), planningStates: { 'activity-a': 'planning' } });
    check(host.querySelector('.composer-contract-chip[data-mode="goal"]')?.getAttribute('data-planning') === 'true', 'Goal planning keeps its contract indicator');
    const executingGoal: PlanProposal = { ...plan, kind: 'goal', executionKind: 'goal', executionId: 'toolbar-goal', executionState: 'running' };
    set({ planCheckpoints: { 'activity-a': executingGoal }, planningStates: {} });
    check(!host.querySelector('.composer-contract-chip') && Boolean(host.querySelector('.goal-progress-capsule')), 'Goal execution uses its progress bar without a second contract status');
    set({ planCheckpoints: { 'activity-a': { ...executingGoal, executionState: 'completed' } } });
    check(Boolean(host.querySelector('.composer-contract-chip[data-mode="goal"]')), 'Goal contract returns when execution is completed');
    set({ sessions: toolbarSessions.map(item => item.id === 'activity-a' ? { ...item, mode: 'plan' } : item), planCheckpoints: { 'activity-a': { ...plan, executionState: 'running' } } });
    check(Boolean(host.querySelector('.composer-contract-chip[data-mode="plan"]')), 'Plan execution keeps the Plan contract indicator');
    set({ sessions: toolbarSessions, planCheckpoints: {}, planningStates: {} });
    const runningPlaceholder = i18n.t('chat.placeholderRunning', { sendShortcut: 'Enter', steerShortcut: '⌥Enter' });
    check(editor()?.getAttribute('aria-placeholder') === runningPlaceholder
      && host.querySelector('.composer-placeholder')?.textContent === runningPlaceholder, 'running empty draft exposes follow-up and steering shortcuts visually and accessibly');
    const emptyInputStyle = getComputedStyle(editor()!);
    const inputLineHeight = Number.parseFloat(emptyInputStyle.lineHeight);
    const emptyInputHeight = editor()!.getBoundingClientRect().height;
    check(Math.abs(Number.parseFloat(emptyInputStyle.minHeight) - inputLineHeight * 2) < 1
      && Math.abs(emptyInputHeight - inputLineHeight * 2) < 1, 'empty chat draft starts at two input lines');
    set({ settings: { ...useAppStore.getState().settings!, enterToSend: false } });
    check(editor()?.getAttribute('aria-placeholder') === i18n.t('chat.placeholderRunning', { sendShortcut: '⌘Enter', steerShortcut: '⌥Enter' }), 'running placeholder follows the configured send shortcut');
    set({ settings: { ...useAppStore.getState().settings!, enterToSend: true } });
    input(Array.from({ length: 12 }, (_, index) => `Draft line ${index + 1}`).join('\n'));
    await until(() => editor()!.scrollHeight > editor()!.clientHeight, 'long draft did not scroll');
    check(editor()!.getBoundingClientRect().height > emptyInputHeight
      && Math.abs(editor()!.getBoundingClientRect().height - inputLineHeight * 7) < 1
      && getComputedStyle(editor()!).overflowY === 'auto', 'long draft grows to seven lines before scrolling');
    input('');
    check(Math.abs(editor()!.getBoundingClientRect().height - emptyInputHeight) < 1
      && getComputedStyle(editor()!).overflowY === 'hidden'
      && host.querySelector('.composer-placeholder')?.textContent === runningPlaceholder, 'clearing the draft restores two lines and the running hint');
    const scheduledHost = document.createElement('div');
    scheduledHost.style.cssText = 'position:fixed;left:0;top:0;width:600px;z-index:2;background:var(--ds-bg-primary);';
    document.body.append(scheduledHost);
    const scheduledRoot = createRoot(scheduledHost, { onUncaughtError: error => errors.push(error) });
    try {
      flushSync(() => scheduledRoot.render(<I18nextProvider i18n={i18n}><ScheduledEditor projects={[]} currentWorkspacePath="/isolated/music" busy={false} save={async () => { throw new Error('Scheduled layout probe must not save a task'); }} cancel={() => {}} /></I18nextProvider>));
      const scheduledInput = scheduledHost.querySelector<HTMLTextAreaElement>('.scheduled-instruction-input')!;
      check(scheduledInput instanceof HTMLTextAreaElement && !scheduledInput.closest('.composer-dock')
        && getComputedStyle(scheduledInput).minHeight === '104px'
        && getComputedStyle(scheduledInput).maxHeight === 'none'
        && scheduledInput.getBoundingClientRect().height >= 104, 'real ScheduledEditor retains its 104 pixel minimum outside the chat compact rule');
    } finally {
      flushSync(() => scheduledRoot.unmount());
      scheduledHost.remove();
    }
    input('请按这个方案继续修改，并保留现有缓存。');
    check(editor()?.getAttribute('aria-placeholder') !== runningPlaceholder
      && !host.querySelector('.composer-placeholder'), 'nonempty running draft restores the contextual placeholder contract');
    await until(()=>Boolean(host.querySelector<HTMLButtonElement>('.send-btn:not(:disabled)')),'Running draft did not expose send');
    check(!host.querySelector('.stop-btn'),'running draft retains steering send slot');
    const left=host.querySelector('.composer-left')!;const right=host.querySelector('.composer-right')!;
    check(Boolean(left.querySelector('.composer-plus') && left.querySelector('.composer-profile-chip')) && !left.querySelector('.composer-model-thinking-chip'), 'plus and profile retain the left toolbar');
    check(Boolean(right.querySelector('.composer-model-thinking-chip')), 'model and reasoning share one right toolbar control');
    const sendBounds = right.querySelector('.send-btn')!.getBoundingClientRect();
    check(Math.abs(sendBounds.width - 32) < .5 && Math.abs(sendBounds.height - 32) < .5 && getComputedStyle(right.querySelector('.send-btn')!).borderRadius === stopRadius, 'send and stop share 32 pixel size and corner radius');
    // Use the production registry/outlets. Plugin registration side and order
    // remain stable as the built-in model picker moves between groups.
    const disposers: (() => void)[] = [];
    try {
      flushSync(() => {
        for (const side of ['left', 'right'] as const) {
          for (const name of ['first', 'second']) {
            disposers.push(slotRegistry.register(`toolbar-${side}-${name}`, {
              slot: 'composerControl', positions: [side],
              component: ({ position }: { position: 'left' | 'right' }) => <Button variant="ghost" data-toolbar-plugin={`${position}-${name}`}>{name === 'first' ? 'A' : 'B'}</Button>,
            }, []));
          }
        }
      });
      for (const side of ['left', 'right'] as const) {
        const group = host.querySelector(`.composer-${side}`)!;
        check([...group.querySelectorAll('[data-toolbar-plugin]')].map(item => item.getAttribute('data-toolbar-plugin')).join(',') === `${side}-first,${side}-second`, `${side} plugin controls preserve side and registration order`);
      }
    } finally {
      flushSync(() => disposers.forEach(dispose => dispose()));
    }
    check(Boolean(right.querySelector('.composer-enhance-btn')&&right.querySelector('.send-btn')),'enhancement and send use right toolbar');
    set({runningSessions:{},isRunning:false});
    const profile=()=>host.querySelector('.composer-profile-chip');
    click(profile());await until(()=>Boolean(document.querySelector('.composer-profile-menu.is-open')),'Profile menu missing');
    await Promise.all(document.querySelector('.composer-profile-menu')!.getAnimations().map(animation=>animation.finished));
    const profileRows=[...document.querySelectorAll('.composer-profile-menu [role="menuitemradio"]')];
    const optionRect=profileRows[0].getBoundingClientRect();check(profileRows[0].contains(document.elementFromPoint(optionRect.left+optionRect.width/2,optionRect.top+optionRect.height/2)),'profile menu is above the chat and pointer reachable');
    check(profileRows.length===2&&profileRows[1].getBoundingClientRect().top-profileRows[0].getBoundingClientRect().bottom>=5.5,'agent and team rows have at least six pixel gap');
    click(profileRows[1]);await until(()=>profile()?.getAttribute('data-profile')==='team','Team profile did not switch');
    const selected=()=>useAppStore.getState().sessions.find(item=>item.id==='activity-a')!;
    check(selected().mode==='agent'&&selected().permissionMode==='auto'&&selected().modelId==='qwen3.8-max','profile switch preserves mode permission and model');
    click(profile());click(document.querySelector('.composer-profile-menu [role="menuitemradio"]'));await until(()=>profile()?.getAttribute('data-profile')==='standard','Standard profile did not switch');
    click(host.querySelector('.composer-model-thinking-chip'));await until(()=>document.querySelectorAll('.composer-model-option').length===2,'Direct model list did not load');
    check(!document.querySelector('.composer-model-tab'),'model list has no default or custom tabs');
    const modelOptions=[...document.querySelectorAll('.composer-model-option')];
    check(modelOptions[1].getBoundingClientRect().top-modelOptions[0].getBoundingClientRect().bottom>=5.5,'model rows have at least six pixel gap');
    const modelSurface=getComputedStyle(document.querySelector('.composer-model-thinking-menu')!);
    check(!modelSurface.backgroundColor.startsWith('rgba(')&&!modelSurface.backgroundColor.includes('/'),'model popup surface is opaque and hides the draft');

    await until(() => Boolean(document.querySelector('.composer-model-menu.is-open')), 'model popup layout did not settle');
    await Promise.all(document.querySelector('.composer-model-menu')!.getAnimations().map(animation => animation.finished));
    const modelPopupBounds = document.querySelector('.composer-model-menu')!.getBoundingClientRect();
    const modelAnchorBounds = right.querySelector('.composer-model-thinking-chip')!.getBoundingClientRect();
    check(modelPopupBounds.left >= 0 && modelPopupBounds.right <= window.innerWidth && modelPopupBounds.top >= 0 && modelPopupBounds.bottom <= modelAnchorBounds.top + 1, 'right model menu opens above its anchor inside the viewport');
    check(Math.abs(modelPopupBounds.right - modelAnchorBounds.right) <= 1, `model menu keeps end alignment after moving right; menu=${modelPopupBounds.left},${modelPopupBounds.right}; anchor=${modelAnchorBounds.left},${modelAnchorBounds.right}`);
    const firstModel = modelOptions[0] as HTMLButtonElement;
    firstModel.focus();
    flushSync(() => firstModel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    check(document.activeElement === modelOptions[1], 'model menu ArrowDown reaches the next model');
    flushSync(() => modelOptions[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await until(()=>selected().modelId==='gpt-6.1-sol','Keyboard session model selection did not persist');
    flushSync(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await until(() => !document.querySelector('.composer-model-menu'), 'Escape did not close the relocated model menu');
    check(document.activeElement === right.querySelector('.composer-model-thinking-chip'), 'relocated model menu restores focus to its trigger');
    click(right.querySelector('.composer-model-thinking-chip'));
    await until(() => Boolean(document.querySelector('.composer-model-settings')), 'model menu did not reopen after keyboard selection');
    check(selected().permissionMode==='auto'&&selected().executionProfile==='standard','model selection preserves permission and profile');
    await until(()=>Boolean(document.querySelector('.composer-model-settings')),'Model management entry missing');click(document.querySelector('.composer-model-settings'));
    check(useAppStore.getState().page==='settings'&&useAppStore.getState().settingsTab==='agent','model management navigates existing settings route');set({page:'chat'});
    await useAppStore.getState().configureActiveSession({mode:'agent',providerId:provider.id,modelId:'qwen3.8-max',thinkingLevel:'off'});
    // Keep the mixed completed regression above separate from the running demo.
    const previewMessages=messages.filter(message=>message.id!=='activity-wait').map(message=>message.id==='activity-task'?{...message,toolStatus:'running' as const}:message.id==='activity-child-answer'?{...message,status:'streaming' as const}:message);
    set({messages:previewMessages,retainedTranscripts:{'activity-a':previewMessages,'activity-b':second},runningSessions:{'activity-a':true},isRunning:true});
    const meter=()=>host.querySelector<HTMLButtonElement>('.composer-usage-context-btn');
    check(Boolean(host.querySelector('.composer-usage-context[data-unavailable="true"]')&&meter()?.disabled&&meter()?.textContent?.includes('—')),'missing usage displays unknown rather than a fabricated percentage');
    check(meter()?.querySelector('.composer-usage-label')?.textContent === i18n.t('chat.usageContextLabel'), 'unknown context footer includes its visible label');
    const outputMessages=['0001-deadline-based-timer.md','0002-clock-choice-and-sleep.md','flutter-doctor.txt','0005-tray-manager-pin.md'].map((name,index)=>msg(`output-${index}`,'tool','Written',{toolName:'Write',toolStatus:'success',toolArgs:{path:`/isolated/music/docs/${name}`}}));
    const usageMessages=previewMessages.map(message=>message.id==='activity-text'?{...message,providerId:provider.id,modelId:'qwen3.8-max',usage:{inputTokens:27520,outputTokens:1024,totalTokens:28544},responseDurationMs:32000}:message.id==='activity-child-answer'?{...message,usage:{inputTokens:900000,outputTokens:1000}}:message);
    set({messages:usageMessages,retainedTranscripts:{'activity-a':usageMessages,'activity-b':second},settings:{...useAppStore.getState().settings!,contextUsageDisplay:'used'}});
    await until(()=>meter()?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')==='11','context progress did not use real parent-message usage');
    check(Boolean(meter()?.textContent?.includes('11%')),'context percentage and progress bar agree');
    check(meter()?.querySelector('.composer-usage-label')?.textContent === i18n.t('chat.usageContextLabel'), 'known context footer includes its visible label');
    const track=meter()!.querySelector('.composer-usage-context-track')!.getBoundingClientRect();const fill=meter()!.querySelector('.composer-usage-context-fill')!.getBoundingClientRect();
    check(Math.abs(fill.width/track.width-28544/262144)<.01,'bar width uses reported tokens over configured context window');
    check(meter()!.getBoundingClientRect().right>=host.querySelector('.composer-shell')!.getBoundingClientRect().right-10,'context meter is right aligned below the input');
    click(meter());await until(()=>Boolean(document.querySelector('.context-inspector-popover.is-open')),'context details did not open');
    const contextPanel=document.querySelector<HTMLElement>('.context-inspector-popover')!;
    check(!host.querySelector('.composer-usage-speed,.composer-usage-total,.composer-usage-cache'),'metrics live only inside the context popup');
    check(Boolean(host.querySelector('.composer-workspace-context')?.textContent?.includes('PI-Desktop'))&&Boolean(host.querySelector('.composer-workspace-context')?.textContent?.includes('本地'))&&Boolean(host.querySelector('.composer-workspace-context')?.textContent?.includes('main')),'footer shows actual project host and branch metadata');
    check(Boolean(contextPanel.textContent?.includes('生成速度'))&&Boolean(contextPanel.textContent?.includes('本轮合计')),'context popup retains speed and turn statistics');
    check(Boolean(contextPanel.querySelector('[role="progressbar"][aria-valuenow="11"]')),'context panel displays total occupancy');
    const panelTrack=contextPanel.querySelector('.context-inspector-occupancy-track')!.getBoundingClientRect();const panelFill=contextPanel.querySelector('.context-inspector-occupancy-fill')!.getBoundingClientRect();
    check(panelFill.height>1&&Math.abs(panelFill.width/panelTrack.width-28544/262144)<.01,'context detail bar visibly fills the reported occupancy');
    check(Boolean(contextPanel.querySelector<HTMLButtonElement>('.context-inspector-compact-action')?.disabled),'running conversation cannot compact from the popup');
    const contextBounds=contextPanel.getBoundingClientRect();check(contextBounds.left>=0&&contextBounds.right<=host.querySelector('.composer-shell')!.getBoundingClientRect().right+1,'context popup stays aligned inside the input region');
    flushSync(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await until(()=>!document.querySelector('.context-inspector-popover'),'Escape closes context details');
    check(document.activeElement===meter(),'context Escape returns focus to the meter');
    set({settings:{...useAppStore.getState().settings!,contextUsageDisplay:'remaining'}});await until(()=>meter()?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')==='89','remaining display preference was not preserved');
    set({settings:{...useAppStore.getState().settings!,contextUsageDisplay:'used'},runningSessions:{},isRunning:false});click(meter());await until(()=>Boolean(document.querySelector<HTMLButtonElement>('.context-inspector-compact-action:not(:disabled)')),'idle local conversation cannot reach compaction');
    click(document.querySelector('.context-inspector-compact-action'));await until(()=>calls.includes('compact:activity-a'),'context button did not use existing compaction workflow');
    check(useAppStore.getState().runningSessions['activity-a']===true&&!document.querySelector('.context-inspector-popover'),'compaction starts only captured session and closes the popup');
    set({runningSessions:{'activity-a':true},isRunning:true});
    click(meter());set({activeSessionId:'activity-b',messages:second,workPanelOpen:false});await until(()=>!document.querySelector('.context-inspector-popover'),'session switch retained another session context popup');
    set({activeSessionId:'activity-a',messages:usageMessages});await until(()=>Boolean(rail()),'usage preview rail did not return');
    const skillArea=()=>rail()?.querySelector('.session-skill-suggestions');
    const suggestions=[{"name": "verify-dart-package-api", "description": "写代码前核实 Dart/Flutter 包真实 API 的流程，保留可查证的调用证据。", "reason": "该任务已记录真实包 API 与调用证据，可供同项目后续修改复用。", "body": "# API evidence\n\nVerify package API names against installed source and primary documentation before changing call sites."}, {"name": "mutation-check-harness", "description": "用可复现的隔离流程对关键断言做变异检查，确认测试能够发现错误。", "body": "# Regression evidence\n\nUse isolated fixtures and verify that a focused regression assertion fails on the known faulty behavior."}, {"name": "pubdev-dependency-triage", "description": "规划 Flutter 项目前先核查候选包的版本、平台支持与依赖边界。", "body": "# Dependency checks\n\nRecord selected package version and supported platforms from primary documentation before committing to a dependency."}, {"name": "flutter-sdk-bootstrap-macos", "description": "在已有 Flutter 安装的开发机上，为单个项目确认并记录实际工具链。", "body": "# Toolchain evidence\n\nInspect the existing toolchain and project requirements. Reuse compatible dependencies and keep test profiles isolated."}];
    const suggestionMessage=msg('activity-suggestions','assistant','```skill-suggestions\n'+JSON.stringify(suggestions)+'\n```',{status:'complete'});
    set({isRunning:false,runningSessions:{},messages:usageMessages});
    click(skillArea()?.querySelector('.session-skill-suggestions-count'));
    const generationButton=()=>document.querySelector<HTMLButtonElement>('.session-skill-suggestions-popover .session-skill-suggestions-generate');
    const openSuggestions=async()=>{const trigger=skillArea()?.querySelector('.session-skill-suggestions-count');if(trigger?.getAttribute('aria-expanded')!=='true')click(trigger);await until(()=>Boolean(document.querySelector('.session-skill-suggestions-popover.is-open')),'suggestions flyout did not open');};
    let resolveGeneration:(value:{accepted:boolean;turnId:string})=>void=()=>{};
    api.prompt=async request=>{calls.push(`suggest:${request.sessionId}:${request.content.includes('skill-suggestions')}`);return new Promise(resolve=>{resolveGeneration=resolve;});};
    click(generationButton());await until(()=>calls.includes('suggest:activity-a:true'),'suggestions did not use the real send workflow');
    check(useAppStore.getState().runningSessions['activity-a']===true,'skill generation follows the session runtime');
    set({activeSessionId:'activity-b',retainedSessionIds:['activity-b','activity-a'],messages:second,isRunning:false});resolveGeneration({accepted:true,turnId:'isolated-skill-turn'});
    await until(()=>rail()?.getAttribute('data-session-id')==='activity-b','skill generation session switch failed');
    check(!document.querySelector('.ext-sheet'),'late generation does not open another session editor');
    const skillMessages=[suggestionMessage,...outputMessages,...usageMessages];
    set({activeSessionId:'activity-a',retainedSessionIds:['activity-a','activity-b'],messages:skillMessages,isRunning:false,runningSessions:{},retainedTranscripts:{'activity-a':skillMessages,'activity-b':second}});
    await until(()=>Boolean(skillArea()?.querySelector('.session-skill-reference')),'recorded suggestions did not render');
    await openSuggestions();
    await until(()=>Boolean(generationButton()&&!generationButton()!.disabled),'generation completion did not release review');
    click(document.querySelector('.session-skill-suggestion-create'));
    await until(()=>Boolean(document.querySelector('.ext-sheet')),'shared skill editor did not open');
    const skillName=document.querySelector<HTMLInputElement>('.ext-sheet input')!;
    flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(skillName,'reviewed-popup-checks');skillName.dispatchEvent(new Event('input',{bubbles:true}));});
    let resolveSave:(value:Awaited<ReturnType<typeof api.createUserSkill>>)=>void=()=>{};
    api.createUserSkill=async input=>{calls.push(`skill:${input.projectPath}:${input.name}:${input.enabled}`);return new Promise(resolve=>{resolveSave=resolve;});};
    const saveSkill=()=>document.querySelector<HTMLButtonElement>('.ext-sheet-actions-end button:last-child');
    const saveControl=saveSkill();click(saveControl);click(saveControl);await until(()=>calls.some(call=>call==='skill:/isolated/music:reviewed-popup-checks:false'),'reviewed project skill was not submitted');
    check(calls.filter(call=>call.startsWith('skill:')).length===1,'duplicate skill save is prevented');
    set({activeSessionId:'activity-b',retainedSessionIds:['activity-b','activity-a'],messages:second,isRunning:false});await until(()=>!document.querySelector('.ext-sheet'),'switching sessions retained the project editor');
    resolveSave({skill:{id:'reviewed-popup-checks',name:'reviewed-popup-checks',description:suggestions[0].description,enabled:false,level:'project',projectPath:'/isolated/music',source:'created',path:'/isolated/music/.agents/skills/reviewed-popup-checks.md',sizeBytes:300,createdAt,updatedAt:createdAt}});
    set({activeSessionId:'activity-a',retainedSessionIds:['activity-a','activity-b'],messages:skillMessages,isRunning:false,runningSessions:{}});await until(()=>Boolean(skillArea()),'skill preview did not return');
    await openSuggestions();
    await until(()=>Boolean(generationButton()&&!generationButton()!.disabled),'save completion did not release review');
    click(document.querySelector('.session-skill-suggestion-create'));await until(()=>Boolean(document.querySelector('.ext-sheet')),'skill review reopening failed');
    api.createUserSkill=async()=>{throw new Error('Isolated duplicate-name error');};
    click(saveSkill());await until(()=>!saveSkill()?.disabled,'skill save failure did not release the editor');
    check(Boolean(document.querySelector('.ext-sheet')),'save error preserves editable skill draft');
    api.createUserSkill=async input=>({skill:{id:input.name,name:input.name,description:input.description,enabled:false,level:'project',projectPath:input.projectPath,source:'created',path:`${input.projectPath}/.agents/skills/${input.name}.md`,sizeBytes:300,createdAt,updatedAt:createdAt}});
    click(saveSkill());await until(()=>!document.querySelector('.ext-sheet'),'successful project skill creation did not close review');
    check(Boolean(skillArea()?.querySelector('.session-skill-reference')),'saving a skill preserves the recorded suggestion evidence');
    api.createUserSkill=original.createSkill;
    await openSuggestions();
    check(document.querySelectorAll('.session-skill-suggestion').length===4&&skillArea()?.querySelector('.session-skill-suggestions-count')?.textContent?.includes('4'),'count opens four suggestion details');
    const popup=document.querySelector<HTMLElement>('.session-skill-suggestions-popover')!;const popupBounds=popup.getBoundingClientRect();
    check(popupBounds.left>=0&&popupBounds.right<=window.innerWidth&&popupBounds.top>=0&&popupBounds.bottom<=window.innerHeight,'suggestion flyout stays within viewport');
    check(!skillArea()?.textContent?.includes(suggestions[0].description),'sidebar suggestions show names without descriptions');
    flushSync(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    await until(()=>!document.querySelector('.session-skill-suggestions-popover'),'Escape closes suggestion flyout');
    check(document.activeElement===skillArea()?.querySelector('.session-skill-suggestions-count'),'Escape restores focus to the count');
    await openSuggestions();click(document.querySelector('.session-skill-suggestion-ignore'));
    check(document.querySelectorAll('.session-skill-suggestion').length===3&&skillArea()?.querySelectorAll('.session-skill-reference').length===3,'Ignore updates count and both suggestion lists');
    set({activeSessionId:'activity-b',retainedSessionIds:['activity-b'],messages:second,isRunning:false});await until(()=>rail()?.getAttribute('data-session-id')==='activity-b','ignored suggestion remount switch failed');
    set({activeSessionId:'activity-a',retainedSessionIds:['activity-a','activity-b'],messages:skillMessages,isRunning:false});await until(()=>rail()?.getAttribute('data-session-id')==='activity-a','ignored suggestion owner did not remount');
    check(skillArea()?.querySelectorAll('.session-skill-reference').length===3,'ignored suggestion stays hidden after remount');
    const referenceMessages=[...skillMessages,msg('recorded-skill','user','Reference fixture',{skillMentions:[{id:'recorded-preview-skill'}]}),msg('recorded-mcp','tool','OK',{toolName:'mcp_preview_lookup',toolStatus:'success'})];
    set({messages:referenceMessages});
    check(skillArea()?.textContent?.includes('recorded-preview-skill')&&skillArea()?.textContent?.includes('mcp_preview_lookup'),'recorded Skill and MCP references share the sidebar section');
    const previewSkillMessages=[{...suggestionMessage,id:'activity-preview-suggestions'},...outputMessages,...usageMessages];
    set({messages:previewSkillMessages,retainedTranscripts:{'activity-a':previewSkillMessages,'activity-b':second},isRunning:true,runningSessions:{'activity-a':true}});
    check(skillArea()?.querySelectorAll('.session-skill-reference').length===4,'newly generated source has independent suggestion preferences');

    await openSuggestions();
    check(document.querySelector('.session-skill-suggestion-rationale')?.textContent?.includes(i18n.t('panel.activity.skills.whyRecommended'))
      && document.querySelector('.session-skill-suggestion-reason')?.textContent === suggestions[0].reason, 'recommendation rationale uses recorded task evidence');
    flushSync(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    const sixSuggestions = [...suggestions, { ...suggestions[0], name: 'review-extra-five' }, { ...suggestions[1], name: 'review-extra-six' }];
    const sixSkillMessages = [msg('inline-ignore-source', 'assistant', '```skill-suggestions\n'+JSON.stringify(sixSuggestions)+'\n```', { status: 'complete' }), ...outputMessages, ...usageMessages];
    set({ messages: sixSkillMessages, retainedTranscripts: { 'activity-a': sixSkillMessages, 'activity-b': second } });
    check(skillArea()?.querySelectorAll('.session-skill-reference').length === 5, 'skill references start with five rows');
    click(skillArea()?.querySelector('.session-skill-references-toggle'));
    check(skillArea()?.querySelectorAll('.session-skill-reference').length === 6, 'skill reference list expands all rows');
    click(skillArea()?.querySelector('.session-skill-reference-ignore'));
    check(skillArea()?.querySelectorAll('.session-skill-reference').length === 5 && !skillArea()?.querySelector('.session-skill-reference-name')?.textContent?.includes(suggestions[0].name), 'inline Ignore removes only its recommendation');
    set({ activeSessionId: 'activity-b', retainedSessionIds: ['activity-b'], messages: second });
    await until(()=>rail()?.getAttribute('data-session-id')==='activity-b','inline Ignore remount switch failed');
    set({ activeSessionId: 'activity-a', retainedSessionIds: ['activity-a','activity-b'], messages: sixSkillMessages });
    await until(()=>Boolean(skillArea()),'inline Ignore owner did not return');
    check(!skillArea()?.textContent?.includes(suggestions[0].name), 'inline Ignore preference survives remount');
    set({ messages: previewSkillMessages, retainedTranscripts: { 'activity-a': previewSkillMessages, 'activity-b': second } });

    const footerProbe={host,check,until,click};
    await footerFixture.run(footerProbe);

    globalThis.enableResponsiveComposerPreview=()=>{host.style.width='100%';host.style.height='100%';};
    const escape=()=>flushSync(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    globalThis.composerDesignScene=async scene=>{
      escape();host.style.width=scene==='narrow'?'498px':'1100px';set({workPanelOpen:false});await until(()=>Boolean(editor()),'Preview input missing');
      const skillScene=scene==='skills'||scene==='skills-list';
      const footerScene=scene==='project-menu'||scene==='location-menu'||scene==='branch-menu'||scene==='worktree-create';
      set({isRunning:!skillScene&&!footerScene,runningSessions:{'activity-a':!skillScene&&!footerScene}});
      const skillToggle=skillArea()?.querySelector('.session-skill-suggestions-toggle');
      if(skillToggle?.getAttribute('aria-expanded')==='false')click(skillToggle);
      const outputToggle=[...(rail()?.querySelectorAll('button')??[])].find(button=>button.querySelector('.session-activity-group-title')?.textContent==='产出');
      if(scene!=='outputs'&&outputToggle?.getAttribute('aria-expanded')==='true')click(outputToggle);
      const railScroll=rail()?.closest('.session-activity-scroll');if(railScroll instanceof HTMLElement)railScroll.scrollTop=0;

      if(scene==='profile'){click(profile());await until(()=>Boolean(document.querySelector('.composer-profile-menu.is-open')),'Preview profile missing');}
      if(scene==='context'){click(meter());await until(()=>Boolean(document.querySelector('.context-inspector-popover.is-open')),'Preview context details missing');}
      if(scene==='models'){click(host.querySelector('.composer-model-thinking-chip'));await until(()=>document.querySelectorAll('.composer-model-option').length===2,'Preview models missing');}
      if(scene==='outputs'){click([...rail()!.querySelectorAll('button')].find(button=>button.querySelector('.session-activity-group-title')?.textContent==='产出'));await until(()=>Boolean(rail()?.querySelector('.session-activity-output')),'outputs missing');const output=rail()!.querySelector('.session-activity-output')!;check(output.textContent?.includes('0001-deadline-based-timer.md')&&!output.textContent?.includes('/isolated/'),'output shows basename only');}
      if(scene==='skills')await openSuggestions();
      if(footerScene)await footerFixture.scene(footerProbe,scene);
      if(skillScene){const count=skillArea()?.querySelector('.session-skill-suggestions-count');check(count instanceof HTMLButtonElement&&count.getAttribute('aria-haspopup')==='dialog','suggestion count is an accessible popup action');}
      if(scene==='skills-list'){const icons=[...skillArea()!.querySelectorAll('.session-skill-reference-icon')].map(icon=>icon.getBoundingClientRect().left);check(icons.length===4&&Math.max(...icons)-Math.min(...icons)<.5,'sidebar skill icon columns align for different name lengths');}
      if(scene==='subagent'){host.style.width='1100px';await until(()=>Boolean(rail()),'Preview rail missing');click(rail()?.querySelector('[data-activity-id="activity-delegate"]'));await until(()=>Boolean(host.querySelector('.subagent-transcript-tab')),'Preview delegate missing');host.querySelector<HTMLElement>('[data-preview-panel]')!.style.width='720px';const task=host.querySelector('.subagent-task-toggle');check(task?.getAttribute('aria-expanded')==='false','task prompt starts bounded');click(task);check(task?.getAttribute('aria-expanded')==='true','delegate task expands');click(task);const group=host.querySelector('.subagent-process-summary');click(group);check(group?.getAttribute('aria-expanded')==='true','delegate tool group expands');check(!host.querySelector('.subagent-transcript-tab .review-change-rollback,.subagent-transcript-tab .message-error-dismiss,.subagent-transcript-tab .copy-btn.primary'),'delegate detail has no parent mutation controls');}
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished));
      if(scene==='context'){const panel=document.querySelector<HTMLElement>('.context-inspector-popover')!;const bounds=panel.getBoundingClientRect();check(bounds.right<=host.querySelector('.composer-shell')!.getBoundingClientRect().right+1,'context popup leaves the activity rail uncovered');check(getComputedStyle(panel).opacity==='1'&&panel.contains(document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)),'context popup paints above chat');}
      if(scene==='profile'||scene==='models'){await until(()=>Boolean(document.querySelector(scene==='profile'?'.composer-profile-menu.is-open':'.composer-model-menu.is-open')),'Preview portal did not settle');const menu=document.querySelector<HTMLElement>(scene==='profile'?'.composer-profile-menu':'.composer-model-menu')!;const bounds=menu.getBoundingClientRect();check(getComputedStyle(menu).opacity==='1'&&getComputedStyle(menu).visibility==='visible',`${scene} preview menu is visibly open`);check(menu.contains(document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)),`${scene} preview menu is visually above chat`);}
      if(scene==='narrow'){check(meter()!.getBoundingClientRect().right<=host.querySelector('.composer-shell')!.getBoundingClientRect().right+2,'narrow context meter remains reachable');check(host.scrollWidth<=host.clientWidth,'498 pixel composer has no horizontal overflow');const narrowCard=host.querySelector('.session-pane[data-visible="true"] .subagent-tasks-card')!;check(Math.abs(narrowCard.getBoundingClientRect().width-narrowCard.closest('.message-col')!.getBoundingClientRect().width)<=2,'narrow task card fills reading column');const box=host.querySelector('.composer-shell')!.getBoundingClientRect();const expectedAction = editor()?.textContent?.trim() ? '.send-btn' : '.stop-btn';const narrowAction = host.querySelector(expectedAction);check(Boolean(narrowAction), `narrow running draft exposes ${expectedAction}`);check(narrowAction!.getBoundingClientRect().right<=box.right,'narrow submit action stays in shell');}
    };
    // Real dock geometry: both themes and enlarged type retain the relocated
    // picker, action button and labeled usage footer inside the reading region.
    const originalScale = host.style.getPropertyValue('--font-scale');
    const narrowPluginDisposers: (() => void)[] = [];
    flushSync(() => {
      for (const side of ['left', 'right'] as const) {
        narrowPluginDisposers.push(slotRegistry.register(`toolbar-narrow-${side}`, {
          slot: 'composerControl', positions: [side],
          component: ({ position }: { position: 'left' | 'right' }) => <Button variant="ghost" data-toolbar-plugin={position}>P</Button>,
        }, []));
      }
    });
    try {
      for (const appearance of ['dark', 'light']) {
        document.documentElement.setAttribute('data-theme', appearance);
        host.style.setProperty('--font-scale', '1.4');
        await globalThis.composerDesignScene('narrow');
        await globalThis.composerDesignScene('models');
        // Resize with the real menu open: its viewport hook must re-position it.
        host.style.width = '498px';
        window.dispatchEvent(new Event('resize'));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const menu = document.querySelector<HTMLElement>('.composer-model-menu')!;
        await Promise.all(menu.getAnimations().map(animation => animation.finished));
        const bounds = menu.getBoundingClientRect();
        check(bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight, `${appearance} enlarged narrow model menu stays in viewport`);
        escape();
        const shellBounds = host.querySelector('.composer-shell')!.getBoundingClientRect();
        for (const selector of ['.composer-model-thinking-chip', '.send-btn', '.composer-usage-context-btn', '[data-toolbar-plugin="left"]', '[data-toolbar-plugin="right"]']) {
          const control = host.querySelector<HTMLElement>(selector)!;
          const box = control.getBoundingClientRect();
          check(box.left >= shellBounds.left - 1 && box.right <= shellBounds.right + 1 && box.width > 0 && box.height > 0, `${appearance} enlarged narrow ${selector} remains reachable inside composer`);
        }
        const toolbarBoxes = [...host.querySelectorAll<HTMLElement>('.composer-toolbar button:not([disabled])')].map(control => control.getBoundingClientRect());
        check(toolbarBoxes.every((first, index) => toolbarBoxes.slice(index + 1).every(second => first.right <= second.left + 1 || second.right <= first.left + 1 || first.bottom <= second.top + 1 || second.bottom <= first.top + 1)), `${appearance} enlarged narrow toolbar controls never overlap with plugins`);
        check(host.scrollWidth <= host.clientWidth, `${appearance} enlarged narrow composer has no horizontal overflow`);
        check(meter()?.querySelector('.composer-usage-label')?.textContent === i18n.t('chat.usageContextLabel'), `${appearance} enlarged context label remains visible`);
      }
    } finally {
      flushSync(() => narrowPluginDisposers.forEach(dispose => dispose()));
      if (originalScale) host.style.setProperty('--font-scale', originalScale);
      else host.style.removeProperty('--font-scale');
    }
    document.documentElement.setAttribute('data-theme', 'dark');
    await globalThis.composerDesignScene('default');
    // Exercise the public history/navigation service with only its Host read edge replaced.
    const historicalWrite = msg("earlier-write", "tool", "Written", { toolName: "Write", toolStatus: "success", toolArgs: { path: "history/earlier.txt" } });
    const historyMessages = [historicalWrite, ...previewSkillMessages];
    api.getSession = async (id, options) => {
      calls.push(`history:${id}:${options?.messageAround ?? options?.messageBefore ?? "latest"}`);
      return { session: { ...session(id, "History fixture"), messages: historyMessages, messageStart: 0, messageEnd: historyMessages.length,
        hasMoreBefore: false, hasMoreAfter: Boolean(options?.messageAround) } };
    };
    const reading = createTranscriptReadingRuntime({ get: useAppStore.getState, set: useAppStore.setState }, (id, options) => api.getSession(id, options));
    set({ ...reading.actions });
    set({ sessionHistory: { "activity-a": { messageStart: 100, hasMoreBefore: true } } });
    await until(() => Boolean(rail()?.querySelector('.session-activity-range-notice button:not([disabled])')), 'Scoped earlier-history action missing');
    const outputsHeading = () => rail()?.querySelector('[data-activity-group="outputs"] .session-activity-disclosure');
    if (outputsHeading()?.getAttribute('aria-expanded') !== 'true') click(outputsHeading());
    click(rail()?.querySelector('[data-activity-group="outputs"] .session-activity-range-notice button:not([disabled])'));
    await until(() => Boolean(rail()?.querySelector('[data-activity-id="change:history/earlier.txt"]')), 'Loading earlier did not add recorded output');
    check(calls.includes('history:activity-a:100'), 'earlier-history uses bounded session read cursor');
    const earlierRow = () => rail()?.querySelector('[data-activity-item-id="change:history/earlier.txt"]');
    const pathButton = earlierRow()?.querySelector<HTMLButtonElement>('.session-activity-tail-actions button:last-child');
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const copiedPaths: string[] = [];
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copiedPaths.push(text); } } });
      click(pathButton); await until(() => copiedPaths.length === 1, 'output path copy did not use clipboard edge');
      check(copiedPaths[0] === 'history/earlier.txt', 'copy action preserves recorded literal path');
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
    const locateButton = earlierRow()?.querySelector<HTMLButtonElement>('.session-activity-tail-actions button:nth-child(2)');
    click(locateButton);
    await until(() => useAppStore.getState().transcriptViews['activity-a']?.focus?.messageId === 'earlier-write', 'output locate did not enter public transcript navigation');
    check(calls.includes('history:activity-a:earlier-write'), 'message locate reads its owning session target');
    await until(() => Boolean(rail()?.querySelector('.session-activity-range-notice button:last-child')), 'historical return-to-latest missing');
    click(rail()?.querySelector('.session-activity-range-notice button:last-child'));
    check(!useAppStore.getState().transcriptViews['activity-a'], 'return-to-latest releases historical reading range');
    set({ pendingPermissions: { 'activity-a': [{ requestId: 'attention-permission', sessionId: 'activity-a', toolCallId: 'approval-call', toolName: 'Read', argsPreview: { path: 'fixture.txt' }, risk: 'low', reason: 'Isolated approval fixture' }] } });
    await until(() => Boolean(rail()?.querySelector('.session-activity-attention-link')), 'approval attention missing');
    click([...rail()!.querySelectorAll('.session-activity-attention-link')].find(element => element.textContent === i18n.t('panel.activity.attentionApprovals', { count: 1 })));
    await until(() => Boolean(host.querySelector('.session-pane[data-visible="true"] .permission-card')?.contains(document.activeElement)), 'approval attention did not focus the permission card');
    check(useAppStore.getState().pendingPermissions['activity-a']?.length === 1, 'attention navigation never answers an approval');
    set({ pendingPermissions: {}, sessionHistory: {} });
    const goalPlan: PlanProposal = { ...plan, kind: "goal", executionId: "overview-goal", executionState: "completed" };
    api.getGoalProgress = async () => ({ progress: { schemaVersion: 1, sessionId: "activity-a", executionId: "overview-goal", proposalId: plan.id, revision: 6, updatedAt: 1,
      items: Array.from({ length: 8 }, (_, index) => ({ id: `T${index + 1}`, label: `Task ${index + 1}`, status: index < 5 ? "completed" : "pending" })) } });
    api.getGoalReport = async () => ({ state: "ready", report: { sessionId: "activity-a", executionId: "overview-goal", integrity: { kind: "fallback" } } } as Awaited<ReturnType<typeof api.getGoalReport>>);
    api.onGoalProgressChanged = () => () => {};
    let reportListener: Parameters<typeof api.onGoalReportChanged>[0] | undefined;
    let reportFailed = false;
    const fallbackRead = api.getGoalReport;
    api.getGoalReport = async params => reportFailed ? { state: "failed", report: null, detail: "Isolated publication failure" } : fallbackRead(params);
    api.onGoalReportChanged = listener => { reportListener = listener; return () => { reportListener = undefined; }; };
    set({ planHistory: { "activity-a": [goalPlan] } });
    await until(() => rail()?.querySelector('.session-activity-goal-progress')?.textContent === '5/8', 'Overview authoritative Goal count missing');
    check(rail()?.querySelector('.session-activity-goal-report')?.textContent === i18n.t('panel.activity.goal.reportFallback'), 'Overview fallback status missing');
    const planHeading = () => rail()?.querySelector('[data-activity-group="plans"] .session-activity-disclosure');
    if (planHeading()?.getAttribute('aria-expanded') === 'true') click(planHeading());
    reportFailed = true;
    reportListener?.({ sessionId: "activity-a", executionId: "overview-goal", proposalId: plan.id, reportId: "overview-report", status: "failed" });
    await until(() => planHeading()?.getAttribute('aria-expanded') === 'true', 'New Goal publication failure did not expand plans');
    check(rail()?.querySelector('.session-activity-goal-report')?.textContent === i18n.t('panel.activity.goal.reportFailed'), 'Goal failure remains observable');
    click(planHeading());
    set({ activeSessionId: "activity-b", retainedSessionIds: ["activity-b", "activity-a"], messages: second });
    await until(() => rail()?.getAttribute('data-session-id') === 'activity-b', 'Failed Goal hide did not switch');
    set({ activeSessionId: "activity-a", retainedSessionIds: ["activity-a", "activity-b"], messages: previewSkillMessages });
    await until(() => rail()?.querySelector('.session-activity-goal-report')?.textContent === i18n.t('panel.activity.goal.reportFailed'), 'Failed Goal snapshot did not return');
    check(planHeading()?.getAttribute('aria-expanded') === 'false', 'Unchanged Goal failure preserves manual collapse after hide/show');
    set({ activeSessionId: "activity-b", retainedSessionIds: ["activity-b"], messages: second });
    await until(() => rail()?.getAttribute('data-session-id') === 'activity-b', 'Failed Goal remount switch missing');
    set({ activeSessionId: "activity-a", retainedSessionIds: ["activity-a", "activity-b"], messages: previewSkillMessages });
    await until(() => rail()?.querySelector('.session-activity-goal-report')?.textContent === i18n.t('panel.activity.goal.reportFailed'), 'Failed Goal remount read missing');
    check(planHeading()?.getAttribute('aria-expanded') === 'false', 'Persisted collapsed Goal failure survives owner remount before report read');
    const readableReport = api.getGoalReport;
    let reportUnavailable = true;
    api.getGoalReport = async params => { if (reportUnavailable) throw new Error("Isolated report read error"); return readableReport(params); };
    set({ activeSessionId: "activity-b", retainedSessionIds: ["activity-b"], messages: second });
    await until(() => rail()?.getAttribute('data-session-id') === 'activity-b', 'Unavailable Goal remount switch missing');
    set({ activeSessionId: "activity-a", retainedSessionIds: ["activity-a", "activity-b"], messages: previewSkillMessages });
    await until(() => rail()?.querySelector('.session-activity-goal-report')?.textContent === i18n.t('panel.activity.goal.reportUnavailable'), 'Report read error was hidden');
    check(planHeading()?.getAttribute('aria-expanded') === 'false', 'Unavailable report preserves known collapsed attention');
    set({ planHistory: { "activity-a": [goalPlan, { ...plan, id: "new-running-plan", executionState: "running" }] } });
    await until(() => planHeading()?.getAttribute('aria-expanded') === 'true', 'Unknown historical report blocked new running plan attention');
    reportUnavailable = false;
    api.getGoalReport = readableReport;
    set({ planHistory: { "activity-a": [goalPlan] } });
    reportFailed = false;
    reportListener?.({ sessionId: "activity-a", executionId: "overview-goal", proposalId: plan.id, reportId: "overview-report", status: "ready" });
    await until(() => rail()?.querySelector('.session-activity-goal-report')?.textContent === i18n.t('panel.activity.goal.reportFallback'), 'Fallback preview did not recover');
    const inlineGoal: PlanProposal = { ...goalPlan, id: 'inline-goal-plan', executionId: 'inline-goal-execution', executionState: 'running' };
    const readProgressBeforeInline = api.getGoalProgress;
    const readReportBeforeInline = api.getGoalReport;
    let resolveInlineProgress!: (value: Awaited<ReturnType<typeof api.getGoalProgress>>) => void;
    const firstInlineProgress = new Promise<Awaited<ReturnType<typeof api.getGoalProgress>>>((resolve) => { resolveInlineProgress = resolve; });
    let firstInlineRead = true;
    let inlineListener: Parameters<typeof api.onGoalProgressChanged>[0] | undefined;
    const inlineSnapshot = { schemaVersion: 1 as const, sessionId: 'activity-a', proposalId: inlineGoal.id,
      executionId: inlineGoal.executionId!, revision: 1, updatedAt: 1,
      items: [{ id: 'inline-done', label: 'Recorded completed step', status: 'completed' as const },
        { id: 'inline-next', label: 'Recorded next step', status: 'pending' as const }] };
    api.getGoalProgress = async params => {
      if (params.executionId !== inlineGoal.executionId) return readProgressBeforeInline(params);
      if (firstInlineRead) { firstInlineRead = false; return firstInlineProgress; }
      return { progress: inlineSnapshot };
    };
    api.getGoalReport = async params => params.executionId === inlineGoal.executionId
      ? { state: 'pending', report: null } : readReportBeforeInline(params);
    api.onGoalProgressChanged = listener => { inlineListener = listener; return () => { inlineListener = undefined; }; };
    set({ planCheckpoints: { 'activity-a': inlineGoal } });
    const inlineBar = () => host.querySelector<HTMLElement>('.composer-shell > .goal-progress-stack');
    await until(() => Boolean(inlineBar()), 'Goal progress did not mount inside the actual Composer input card');
    check(inlineBar()?.querySelectorAll('[role="status"]').length === 1, 'Goal has one live status inside the input card');
    check(inlineBar()?.querySelector('[role="status"]')?.textContent === i18n.t('goal.progressInitializing'), 'First read shows loading only');
    const goalSurface = inlineBar()!.querySelector<HTMLElement>('.goal-progress-bar')!;
    const goalStyle = getComputedStyle(goalSurface);
    check(goalStyle.borderTopWidth === '0px' && goalStyle.borderBottomWidth === '1px' && goalStyle.borderRadius === '0px', 'Goal uses only the input-card divider');
    resolveInlineProgress({ progress: null });
    await until(() => inlineBar()?.querySelector('[role="status"]')?.textContent === i18n.t('chat.scheduleExecutionState.running'), 'Empty successful read did not show Running');
    check(Boolean(inlineBar()?.querySelector('.goal-progress-indeterminate')) && !inlineBar()?.querySelector('.goal-progress-completed-num'), 'Running without a snapshot uses an indeterminate indicator without a fake count');
    inlineListener?.({ sessionId: 'activity-a', executionId: inlineGoal.executionId!, revision: 1 });
    await until(() => inlineBar()?.querySelector('.goal-progress-completed-num')?.textContent === '1', 'Real progress did not replace the indeterminate indicator');
    check(inlineBar()?.querySelector('[role="status"]')?.getAttribute('aria-label')?.includes('1/2'), 'True Goal count remains announced');
    click(inlineBar()?.querySelector('.goal-progress-toggle-btn'));
    await until(() => Boolean(inlineBar()?.querySelector('[role="list"]')), 'Inline Goal did not expand its recorded task list');
    click(inlineBar()?.querySelector('.goal-progress-toggle-btn'));
    check(!inlineBar()?.querySelector('[role="list"]'), 'Inline Goal task list collapses without detaching the input');
    const inlineWidth = host.style.width;
    const inlineScale = document.documentElement.style.getPropertyValue('--font-scale');
    for (const inlineTheme of ['dark', 'light']) {
      document.documentElement.setAttribute('data-theme', inlineTheme);
      host.style.width = '760px';
      document.documentElement.style.setProperty('--font-scale', '1.4');
      await until(() => inlineBar()!.getBoundingClientRect().width < 600, 'Inline Goal did not enter its narrow reading column');
      const inlineShell = inlineBar()!.parentElement!;
      check(inlineShell.scrollWidth <= inlineShell.clientWidth + 1, `${inlineTheme}: inline Goal has no overflow with enlarged text`);
      const inlineStatus = inlineBar()!.querySelector<HTMLElement>('[role="status"]')!;
      check(inlineStatus.getBoundingClientRect().right <= inlineShell.getBoundingClientRect().right + 1,
        `${inlineTheme}: the single Goal status remains inside the narrow input card`);
    }
    host.style.width = inlineWidth;
    document.documentElement.style.setProperty('--font-scale', inlineScale || '1');
    document.documentElement.setAttribute('data-theme', 'dark');
    checks.push('E2E-GOAL-inline-input-status');
    api.getGoalProgress = readProgressBeforeInline;
    api.getGoalReport = readReportBeforeInline;
    api.onGoalProgressChanged = () => () => {};
    for (const group of ["plans", "agents", "processes"]) {
      const heading = rail()?.querySelector(`[data-activity-group="${group}"] .session-activity-disclosure`);
      if (heading?.getAttribute('aria-expanded') === 'false') click(heading);
    }
    await until(() => Boolean(rail()?.querySelector('[data-process-id="activity-job"]')), 'Process preview missing');
    const evidencePath = "/isolated/music/docs/0001-deadline-based-timer.md";
    const recordedReview = (id: string, operation: "write" | "edit", additions: number, deletions: number) => ({ details: { root: "workspace", review: {
      version: 1, snapshotId: `evidence:${id}`, messageId: id, path: evidencePath, operation, status: operation === "write" ? "added" : "modified",
      state: "active", additions, deletions, hunks: [], reversible: true,
    } } });
    const evidenceMessages = previewSkillMessages.map(message => message.id === "output-0" ? { ...message, toolResult: recordedReview(message.id, "write", 1, 0) } : message);
    evidenceMessages.push(msg("evidence-edit", "tool", "Edited", { toolName: "Edit", toolStatus: "success", toolArgs: { path: evidencePath }, toolResult: recordedReview("evidence-edit", "edit", 2, 1) }));
    evidenceMessages.push(msg("evidence-search", "assistant", "Recorded source evidence", { hostedSearch: { status: "completed", rounds: [{ id: "source-round", status: "completed", sources: [
      { url: "https://docs.example.org/first", title: "Reference one" }, { url: "https://docs.example.org/second", title: "Reference two" },
    ] }] } }));
    set({ messages: evidenceMessages, retainedTranscripts: { "activity-a": evidenceMessages, "activity-b": second } });
    const sourceHeading = rail()?.querySelector('[data-activity-group="sources"] .session-activity-disclosure');
    if (sourceHeading?.getAttribute('aria-expanded') === 'false') click(sourceHeading);
    const sourceRow = rail()?.querySelector('[data-activity-id="https://docs.example.org/first"]');
    check(sourceRow?.textContent?.includes("docs.example.org") && sourceRow?.textContent?.includes(i18n.t("panel.activity.sourceCount", { count: 2 })), 'source domains consume loaded citation counts in production Overview');
    click(sourceRow);
    const browserTab = useAppStore.getState().workPanelTabs.find(tab => tab.id === useAppStore.getState().activeWorkPanelTabId);
    check(browserTab?.location === "https://docs.example.org/first" && useAppStore.getState().activeSessionId === "activity-a", 'source opens first safe URL in owning session work panel');
    set({ workPanelOpen: false });
    await until(() => Boolean(rail()), 'source navigation did not return the rail');
    const outputHeading = rail()?.querySelector('[data-activity-group="outputs"] .session-activity-disclosure');
    if (outputHeading?.getAttribute('aria-expanded') === 'false') click(outputHeading);
    const changedRow = rail()?.querySelector('[data-activity-item-id="change:/isolated/music/docs/0001-deadline-based-timer.md"]');
    check(changedRow?.textContent?.includes(i18n.t("panel.activity.writeCount", { count: 2 })) && changedRow?.querySelector('.session-activity-line-changes')?.textContent === "+3−1", 'merged output displays complete Host review evidence');
    input('');
    set({ isRunning: true, runningSessions: { 'activity-a': true } });
    host.style.width = '498px';
    await until(() => host.querySelector('.chat-surface')?.getAttribute('data-activity-visible') === 'false', 'compact composer narrow layout did not release the rail');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const narrowShell = host.querySelector('.composer-shell')!.getBoundingClientRect();
    const narrowHint = host.querySelector('.composer-placeholder')!.getBoundingClientRect();
    check(host.scrollWidth <= host.clientWidth && narrowHint.left >= narrowShell.left
      && narrowHint.right <= narrowShell.right && narrowHint.height <= inputLineHeight * 2 + 1
      && editor()?.getAttribute('aria-placeholder') === runningPlaceholder, '498 pixel empty composer keeps its running hint within the two-line input card');
    checks.push('E2E-COMPOSER-compact-running-input');
    host.style.width = '1100px';
    await until(() => Boolean(rail()), 'compact composer screenshot did not restore the wide rail');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    checks.push('E2E-COMPOSER-toolbar-footer');
    globalThis.cleanupSessionActivityIntegrationProbe=cleanup;return {ok:true,checks};
  }catch(error){cleanup();throw error;}
}
