import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  CircleAlert,
  Download,
  FolderOpen,
  HardDrive,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Upload,
  Waves,
  X,
  Trash2,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sidebar } from "./components/layout/Sidebar";
import { SubtitleTimeline } from "./components/editor/SubtitleTimeline";
import { VideoCanvas, type CanvasPreset, type SubtitleStyle } from "./components/editor/VideoCanvas";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { models } from "./data/mockData";
import {
  chooseVideoFile,
  chooseExportPath,
  chooseProjectFile,
  chooseProjectDirectory,
  choosePythonExecutable,
  createLocalProject,
  deleteLocalProject,
  extractAudio,
  exportCaptions,
  getAppStatus,
  getSettings,
  openLocalProject,
  installDefaultModels,
  probeMedia,
  renameLocalProject,
  runQwenAsr,
  scanSystemFonts,
  saveSettings,
  saveProjectSubtitles,
  saveProjectMedia,
  toMediaUrl,
  type AppStatus,
  type AppSettings,
  type MediaInfo,
  type ProjectInfo,
  type SystemFontInfo,
} from "./services/desktop";
import type { SubtitleLine, ViewId } from "./types/app";
import "./App.css";

const healthTone: Record<SubtitleLine["health"], "success" | "warning" | "danger"> = {
  good: "success",
  warning: "warning",
  danger: "danger",
};

const healthLabel: Record<SubtitleLine["health"], string> = {
  good: "舒适",
  warning: "偏长",
  danger: "需拆分",
};

const emptySubtitle: SubtitleLine = {
  id: "empty-subtitle",
  index: 0,
  start: "00:00:00.000",
  end: "00:00:00.000",
  text: "",
  confidence: 0,
  health: "good",
};

const canvasPresets: CanvasPreset[] = [
  { id: "source", label: "原始", ratio: null },
  { id: "landscape", label: "16:9", ratio: 16 / 9 },
  { id: "portrait", label: "9:16", ratio: 9 / 16 },
  { id: "square", label: "1:1", ratio: 1 },
  { id: "social", label: "4:5", ratio: 4 / 5 },
];

const defaultSubtitleStyle: SubtitleStyle = {
  fontFamily: "Microsoft YaHei",
  fontSize: 48,
  color: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 2,
  strokeMode: "outer",
  opacity: 1,
  positionX: 0,
  positionY: 13,
};

function App() {
  const [currentView, setCurrentView] = useState<ViewId>("dashboard");
  const [selectedSubtitleId, setSelectedSubtitleId] = useState("");
  const [subtitleLines, setSubtitleLines] = useState<SubtitleLine[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(defaultSubtitleStyle);
  const [selectedModelId, setSelectedModelId] = useState("qwen3-asr-06b");
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("未命名字幕项目");
  const [newProjectDirectory, setNewProjectDirectory] = useState("");
  const [createdProjects, setCreatedProjects] = useState<ProjectInfo[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [asrSummary, setAsrSummary] = useState<string | null>(null);
  const [systemFonts, setSystemFonts] = useState<SystemFontInfo[]>([]);
  const [notice, setNotice] = useState("准备就绪");
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<{ title: string; detail: string; startedAt: number } | null>(null);
  const [taskElapsed, setTaskElapsed] = useState(0);
  const subtitleHistoryRef = useRef<SubtitleLine[][]>([]);
  const selectedSubtitle = useMemo(
    () => subtitleLines.find((subtitle) => subtitle.id === selectedSubtitleId) ?? subtitleLines[0] ?? emptySubtitle,
    [selectedSubtitleId, subtitleLines],
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? models[0],
    [selectedModelId],
  );

  function commitSubtitleLines(nextLines: SubtitleLine[]) {
    setSubtitleLines((current) => {
      if (JSON.stringify(current) !== JSON.stringify(nextLines)) {
        subtitleHistoryRef.current = [...subtitleHistoryRef.current.slice(-79), current];
      }
      return nextLines;
    });
  }

  function undoSubtitleChange() {
    const previous = subtitleHistoryRef.current.pop();
    if (!previous) return;
    setSubtitleLines(previous);
    setSelectedSubtitleId((current) => previous.some((line) => line.id === current) ? current : previous[0]?.id ?? "");
    setNotice("已撤销上一次字幕修改");
  }

  useEffect(() => {
    Promise.all([getAppStatus(), getSettings()])
      .then(([status, settings]) => {
        setAppStatus(status);
        setAppSettings(settings);
        setSelectedModelId(settings.default_model);
        setNotice("本地环境检测完成");
      })
      .catch(() => {
        setNotice("浏览器预览模式，Tauri 本地能力需在桌面窗口中使用");
      });
  }, []);

  useEffect(() => {
    if (!activeTask) return;
    const update = () => setTaskElapsed((Date.now() - activeTask.startedAt) / 1000);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [activeTask]);

  useEffect(() => {
    if (!currentProject || subtitleLines.length === 0) return;
    const timer = window.setTimeout(() => {
      saveProjectSubtitles(currentProject.path, subtitleLines).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }, Math.max(1, appSettings?.auto_save_seconds ?? 3) * 1_000);
    return () => window.clearTimeout(timer);
  }, [appSettings?.auto_save_seconds, currentProject, subtitleLines]);

  async function handleSaveSettings(settings: AppSettings) {
    try {
      setError(null);
      setNotice("正在保存本地设置...");
      const saved = await saveSettings(settings);
      setAppSettings(saved);
      setSelectedModelId(saved.default_model);
      const status = await getAppStatus();
      setAppStatus(status);
      setNotice("设置已保存并生效");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("保存设置失败");
    }
  }

  async function refreshEnvironment() {
    try {
      setError(null);
      const status = await getAppStatus();
      setAppStatus(status);
      setNotice("本地运行环境已重新检测");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("环境检测失败");
    }
  }

  async function handleInstallDefaultModels() {
    setActiveTask({ title: "正在安装默认模型", detail: "后台下载 Qwen3-ASR 与时间对齐模型", startedAt: Date.now() });
    try {
      setError(null);
      setNotice("正在下载默认模型，请保持网络连接...");
      const result = await installDefaultModels();
      await refreshEnvironment();
      setNotice(`默认模型已安装：${result.model_path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("默认模型安装失败");
    } finally {
      setActiveTask(null);
    }
  }

  function handleCreateProject() {
    setNewProjectName("未命名字幕项目");
    setNewProjectDirectory(appStatus?.default_project_dir ?? appSettings?.project_dir ?? "");
    setIsProjectDialogOpen(true);
  }

  function resetEditorForNewProject() {
    setMediaInfo(null);
    setAudioPath(null);
    setAsrSummary(null);
    setSubtitleLines([]);
    setSelectedSubtitleId("");
    setSubtitleStyle(defaultSubtitleStyle);
    subtitleHistoryRef.current = [];
  }

  async function createProject(name: string, directory: string) {
    const projectName = name.trim();
    if (!projectName) return;
    try {
      setError(null);
      setNotice("正在创建本地项目...");
      const project = await createLocalProject(projectName, directory.trim() || appStatus?.default_project_dir);
      resetEditorForNewProject();
      setCreatedProjects((current) => [project, ...current]);
      setCurrentProject(project);
      setNotice(`项目已创建：${project.path}`);
      setIsProjectDialogOpen(false);
      setCurrentView("editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("创建项目失败");
    }
  }

  async function handleRenameProject(project: ProjectInfo) {
    const name = window.prompt("请输入新的项目名称", project.name)?.trim();
    if (!name || name === project.name) return;
    try {
      const renamed = await renameLocalProject(project.path, name);
      setCreatedProjects((projects) => projects.map((item) => item.path === project.path ? renamed : item));
      setCurrentProject((item) => item?.path === project.path ? renamed : item);
      setNotice(`项目已重命名为：${renamed.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("项目重命名失败");
    }
  }

  async function handleDeleteProject(project: ProjectInfo) {
    if (!window.confirm(`确认删除项目“${project.name}”？该项目文件、字幕和导出内容将被删除。`)) return;
    try {
      await deleteLocalProject(project.path);
      setCreatedProjects((projects) => projects.filter((item) => item.path !== project.path));
      if (currentProject?.path === project.path) {
        setCurrentProject(null);
        setMediaInfo(null);
        setAudioPath(null);
        setSubtitleLines([]);
      }
      setNotice(`项目已删除：${project.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("项目删除失败");
    }
  }

  async function handleImportVideo() {
    try {
      setError(null);
      setNotice("请选择本地视频或音频文件");
      const path = await chooseVideoFile();
      if (!path) {
        setNotice("已取消选择");
        return;
      }

      setNotice("正在读取媒体信息...");
      const info = await probeMedia(path);
      let project = currentProject;
      if (!project) {
        const projectName = info.file_name.replace(/\.[^.]+$/, "") || "未命名字幕项目";
        setNotice("正在创建本地项目...");
        project = await createLocalProject(projectName, appStatus?.default_project_dir);
        setCreatedProjects((current) => [project!, ...current]);
        setCurrentProject(project);
      }
      setMediaInfo(info);
      await saveProjectMedia(project.path, info.path);
      setAudioPath(null);
      setSubtitleLines([]);
      setSelectedSubtitleId("");
      setAsrSummary(null);
      setNotice(`已导入：${info.file_name}，项目已就绪`);
      setCurrentView("editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("导入媒体失败");
    }
  }

  async function handleOpenProject() {
    try {
      const path = await chooseProjectFile();
      if (!path) return;
      setError(null);
      setNotice("正在打开 CaptionFlow 工程...");
      const opened = await openLocalProject(path);
      const lines = resolveSubtitleOverlaps(opened.subtitles ?? []);
      setCurrentProject(opened.project);
      setCreatedProjects((projects) => [opened.project, ...projects.filter((project) => project.path !== opened.project.path)]);
      setSubtitleLines(lines);
      setSelectedSubtitleId(lines[0]?.id ?? "");
      setAudioPath(null);
      setAsrSummary(null);
      if (opened.media_path) {
        try {
          setMediaInfo(await probeMedia(opened.media_path));
          setNotice(`工程已打开：${opened.project.name}`);
        } catch {
          setMediaInfo(null);
          setNotice("工程已打开，但原始媒体文件已移动或不存在");
        }
      } else {
        setMediaInfo(null);
        setNotice(`工程已打开：${opened.project.name}`);
      }
      setCurrentView("editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("打开工程失败");
    }
  }

  async function handleExtractAudio() {
    if (!mediaInfo) {
      setError("请先导入视频或音频文件");
      return;
    }

    if (!currentProject) {
      setError("请先创建本地项目，再提取音频");
      return;
    }

    try {
      setError(null);
      setNotice("正在提取 16kHz 单声道 WAV 音频...");
      const result = await extractAudio(mediaInfo.path, currentProject.path);
      setAudioPath(result.audio_path);
      setNotice(`音频已提取：${result.audio_path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("音频提取失败");
    }
  }

  async function handleRunAsr() {
    if (!mediaInfo) {
      setError("请先导入视频或音频文件");
      return;
    }

    setActiveTask({ title: "正在识别字幕", detail: "准备本地语音识别引擎", startedAt: Date.now() });
    try {
      setError(null);
      let project = currentProject;
      if (!project) {
        const projectName = mediaInfo.file_name.replace(/\.[^.]+$/, "") || "未命名字幕项目";
        setNotice("正在创建本地项目...");
        project = await createLocalProject(projectName, appStatus?.default_project_dir);
        setCreatedProjects((current) => [project!, ...current]);
        setCurrentProject(project);
      }

      let readyAudioPath = audioPath;
      if (!readyAudioPath) {
        setActiveTask((task) => task ? { ...task, detail: "正在提取识别音频" } : task);
        setNotice("正在提取识别所需音频...");
        const extraction = await extractAudio(mediaInfo.path, project.path);
        readyAudioPath = extraction.audio_path;
        setAudioPath(readyAudioPath);
      }

      setNotice("正在运行 Qwen3-ASR，本步骤可能需要较长时间...");
      setActiveTask((task) => task ? { ...task, detail: "Qwen3-ASR 正在分析语音与时间戳" } : task);
      const mode = selectedModelId === "qwen3-asr-17b" ? "accurate" : "standard";
      const result = await runQwenAsr(readyAudioPath, project.path, mode);
      const text = result.payload.result?.text ?? "";
      const segmentCount = result.payload.result?.segments?.length ?? 0;
      const model = result.payload.result?.runtime?.model ?? "Qwen3-ASR";
      setAsrSummary(`${model} 已生成 ${segmentCount} 条字幕：${text.slice(0, 28)}`);
      const lines = resolveSubtitleOverlaps((result.payload.result?.segments ?? []).map((segment) => ({
        id: segment.subtitle_id,
        index: segment.index,
        start: formatSubtitleTimestamp(segment.start_ms),
        end: formatSubtitleTimestamp(segment.end_ms),
        text: cleanCaptionText(segment.text),
        confidence: segment.confidence ?? 0,
        health: segment.health?.too_long || segment.health?.suggest_split ? "warning" : "good",
      } satisfies SubtitleLine)));
      if (lines.length) {
        setSubtitleLines(lines);
        setSelectedSubtitleId(lines[0].id);
      }
      setNotice(`识别完成：${result.subtitles_path ?? result.output_path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("Qwen3-ASR 识别失败");
    } finally {
      setActiveTask(null);
    }
  }

  async function handleExport(format: "srt" | "ass" | "mp4") {
    if (!currentProject) {
      setError("请先创建或导入本地项目");
      return;
    }
    if (subtitleLines.length === 0) {
      setError("没有可导出的字幕，请先完成识别");
      return;
    }
    if (format === "mp4" && !mediaInfo) {
      setError("烧录视频前请先导入视频");
      return;
    }
    try {
      setError(null);
      const outputPath = await chooseExportPath(format);
      if (!outputPath) {
        setNotice("已取消导出");
        return;
      }
      setActiveTask({ title: format === "mp4" ? "正在烧录字幕视频" : "正在导出字幕文件", detail: format === "mp4" ? "FFmpeg 正在渲染本地视频" : "正在生成字幕文件", startedAt: Date.now() });
      setNotice(format === "mp4" ? "正在后台烧录字幕视频..." : "正在导出字幕文件...");
      const result = await exportCaptions({
        projectPath: currentProject.path,
        sourcePath: mediaInfo?.path,
        outputPath,
        format,
        subtitles: resolveSubtitleOverlaps(subtitleLines),
        style: subtitleStyle,
        videoWidth: mediaInfo?.width,
        videoHeight: mediaInfo?.height,
      });
      setNotice(`导出完成：${result.output_path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("导出失败");
    } finally {
      setActiveTask(null);
    }
  }

  async function handleScanFonts() {
    try {
      setError(null);
      setNotice("正在扫描系统字体...");
      const fonts = await scanSystemFonts();
      setSystemFonts(fonts);
      setNotice(`已扫描到 ${fonts.length} 个字体文件`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotice("扫描字体失败");
    }
  }

  return (
    <div className="app-shell">
      <WindowTitlebar />
      <div className="app-content">
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
        />
        <main className="workspace">
          <Header currentProject={currentProject} currentView={currentView} notice={notice} error={error} />
        {currentView === "dashboard" ? (
          <Dashboard
            appStatus={appStatus}
            createdProjects={createdProjects}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onImportVideo={handleImportVideo}
            onOpenProject={handleOpenProject}
            onOpenEditor={() => setCurrentView("editor")}
            onRenameProject={handleRenameProject}
          />
        ) : null}
        {currentView === "editor" ? (
          <Editor
            mediaInfo={mediaInfo}
            audioPath={audioPath}
            asrSummary={asrSummary}
            currentProject={currentProject}
            onExtractAudio={handleExtractAudio}
            onScanFonts={handleScanFonts}
            onModelChange={setSelectedModelId}
            selectedSubtitle={selectedSubtitle}
            subtitleLines={subtitleLines}
            subtitleStyle={subtitleStyle}
            onSubtitleLinesChange={commitSubtitleLines}
            onSubtitleStyleChange={setSubtitleStyle}
            onUndo={undoSubtitleChange}
            selectedModel={selectedModel}
            selectedModelId={selectedModelId}
            onExport={handleExport}
            onRunAsr={handleRunAsr}
            systemFonts={systemFonts}
            onImportVideo={handleImportVideo}
            onSelectSubtitle={setSelectedSubtitleId}
          />
        ) : null}
        {currentView === "settings" ? <SettingsView appSettings={appSettings} appStatus={appStatus} onInstallDefaultModels={handleInstallDefaultModels} onRefreshEnvironment={refreshEnvironment} onSave={handleSaveSettings} /> : null}
        </main>
      </div>
      {isProjectDialogOpen ? (
        <ProjectCreateDialog
          name={newProjectName}
          projectDirectory={newProjectDirectory}
          onClose={() => setIsProjectDialogOpen(false)}
          onNameChange={setNewProjectName}
          onDirectoryChange={setNewProjectDirectory}
          onChooseDirectory={async () => {
            const directory = await chooseProjectDirectory();
            if (directory) setNewProjectDirectory(directory);
          }}
          onSubmit={() => createProject(newProjectName, newProjectDirectory)}
        />
      ) : null}
      {activeTask ? <TaskOverlay elapsed={taskElapsed} task={activeTask} /> : null}
    </div>
  );
}

function WindowTitlebar() {
  const invokeWindow = async (action: "minimize" | "toggle" | "close") => {
    try {
      const appWindow = getCurrentWindow();
      if (action === "minimize") await appWindow.minimize();
      if (action === "toggle") await appWindow.toggleMaximize();
      if (action === "close") await appWindow.close();
    } catch {
      if (action === "close") window.close();
    }
  };
  const startDragging = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };
  return (
    <div className="window-titlebar" onDoubleClick={() => void invokeWindow("toggle")} onMouseDown={startDragging}>
      <div className="window-brand">
        <img alt="" src="/captionflow-icon.png" />
        <span>CaptionFlow 本地智能字幕</span>
      </div>
      <div className="window-controls">
        <button aria-label="最小化" onClick={() => void invokeWindow("minimize")} onMouseDown={(event) => event.stopPropagation()} type="button"><Minimize2 aria-hidden="true" size={15} /></button>
        <button aria-label="最大化或还原" onClick={() => void invokeWindow("toggle")} onMouseDown={(event) => event.stopPropagation()} type="button"><Maximize2 aria-hidden="true" size={14} /></button>
        <button aria-label="关闭" className="window-close" onClick={() => void invokeWindow("close")} onMouseDown={(event) => event.stopPropagation()} type="button"><X aria-hidden="true" size={16} /></button>
      </div>
    </div>
  );
}

function ProjectCreateDialog({
  name,
  onClose,
  onNameChange,
  onDirectoryChange,
  onChooseDirectory,
  onSubmit,
  projectDirectory,
}: {
  name: string;
  onClose: () => void;
  onNameChange: (name: string) => void;
  onDirectoryChange: (directory: string) => void;
  onChooseDirectory: () => void;
  onSubmit: () => void;
  projectDirectory: string;
}) {
  return (
    <div aria-modal="true" className="modal-backdrop" onMouseDown={onClose} role="dialog">
      <form className="project-create-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div>
          <p className="eyebrow">New Project</p>
          <h3>新建字幕项目</h3>
        </div>
        <label>
          项目名称
          <input autoFocus maxLength={80} onChange={(event) => onNameChange(event.currentTarget.value)} value={name} />
        </label>
        <label>
          项目存放位置
          <div className="project-directory-field">
            <input aria-label="项目存放位置" onChange={(event) => onDirectoryChange(event.currentTarget.value)} placeholder="选择项目存放文件夹" value={projectDirectory} />
            <Button icon={FolderOpen} onClick={onChooseDirectory} type="button">选择</Button>
          </div>
        </label>
        <p className="project-directory">项目将在所选目录中创建一个同名文件夹。</p>
        <div className="dialog-actions">
          <Button onClick={onClose} type="button">取消</Button>
          <Button disabled={!name.trim()} icon={Plus} type="submit" variant="primary">创建项目</Button>
        </div>
      </form>
    </div>
  );
}

function TaskOverlay({ elapsed, task }: { elapsed: number; task: { title: string; detail: string } }) {
  const progress = Math.min(94, 8 + Math.log1p(elapsed) * 19);
  return (
    <div aria-live="polite" className="task-overlay" role="status">
      <div className="task-orbit"><span /><span /><span /></div>
      <div className="task-card">
        <div className="task-icon"><img alt="CaptionFlow" src="/captionflow-icon.png" /></div>
        <p>CAPTIONFLOW ENGINE</p>
        <h3>{task.title}</h3>
        <span>{task.detail}</span>
        <div className="task-progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="task-meta"><strong>{Math.round(progress)}%</strong><span>已运行 {formatTaskDuration(elapsed)}</span></div>
      </div>
    </div>
  );
}

function formatTaskDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

function Header({ currentProject, currentView, error, notice }: { currentProject: ProjectInfo | null; currentView: ViewId; error: string | null; notice: string }) {
  const titleMap: Record<ViewId, string> = {
    dashboard: "工作台",
    editor: "课程口播样片",
    settings: "软件设置",
  };

  const title = currentView === "editor" && currentProject ? currentProject.name : titleMap[currentView];
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Local Desktop MVP</p>
        <h1>{title}</h1>
      </div>
      <div className="topbar-actions">
        <Badge tone={error ? "danger" : "success"}>{error ? "有错误" : notice}</Badge>
        <Button icon={Save} variant="ghost">
          保存
        </Button>
      </div>
      {error ? (
        <div className="runtime-error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </header>
  );
}

function Dashboard({
  appStatus,
  createdProjects,
  onCreateProject,
  onDeleteProject,
  onImportVideo,
  onOpenProject,
  onOpenEditor,
  onRenameProject,
}: {
  appStatus: AppStatus | null;
  createdProjects: ProjectInfo[];
  onCreateProject: () => void;
  onDeleteProject: (project: ProjectInfo) => void;
  onImportVideo: () => void;
  onOpenProject: () => void;
  onOpenEditor: () => void;
  onRenameProject: (project: ProjectInfo) => void;
}) {
  return (
    <section className="view-stack">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">离线识别 · 本地导出 · 系统字体</p>
          <h2>导入视频，生成精准断句字幕</h2>
          <p className="hero-copy">
            使用 Qwen3-ASR 在本机完成语音识别，配合 ForcedAligner 提升时间戳质量，再通过 FFmpeg
            烧录成品视频。
          </p>
        </div>
        <div className="hero-actions">
          <Button icon={Plus} variant="primary" onClick={onCreateProject}>
            新建项目
          </Button>
          <Button icon={FolderOpen} onClick={onOpenProject}>
            打开工程
          </Button>
          <Button icon={Upload} onClick={onImportVideo}>
            导入视频
          </Button>
        </div>
      </div>

      <div className="metrics-grid">
        <Metric icon={HardDrive} label="默认项目目录" value={appStatus?.default_project_dir ?? "检测中"} />
        <Metric icon={Sparkles} label="默认模型" value="Qwen3-ASR-0.6B" />
        <Metric icon={CheckCircle2} label="系统字体" value={`${appStatus?.system_font_count ?? 0} 个文件`} />
        <Metric icon={Clock3} label="FFmpeg" value={appStatus?.ffmpeg.available ? "可用" : "未检测"} />
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent Projects</p>
            <h3>最近项目</h3>
          </div>
          <Button icon={Upload} onClick={onImportVideo}>
            导入视频
          </Button>
          <Button icon={FolderOpen} onClick={onOpenProject}>
            打开工程
          </Button>
        </div>
        <div className="project-list">
          {createdProjects.map((project) => (
            <article className="project-row" key={project.path}>
              <button className="project-open" onClick={onOpenEditor} type="button">
              <div className="project-thumb">
                <FolderOpen aria-hidden="true" size={22} />
              </div>
              <div className="project-main">
                <strong>{project.name}</strong>
                <span>{project.path}</span>
              </div>
              <span>--:--</span>
              <span>本地</span>
              <Badge tone="success">新建</Badge>
              <span className="muted">刚刚</span>
              </button>
              <ProjectActions onDelete={() => onDeleteProject(project)} onRename={() => onRenameProject(project)} />
            </article>
          ))}
          {createdProjects.length === 0 ? <div className="project-empty">还没有本地项目。新建项目或导入媒体后，项目会保存在本机目录中。</div> : null}
        </div>
      </section>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof HardDrive; label: string; value: string }) {
  return (
    <article className="metric">
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ProjectActions({ onDelete, onRename }: { onDelete: () => void; onRename: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="project-actions">
      <button aria-label="项目管理" className="project-action-trigger" onClick={() => setOpen((value) => !value)} title="项目管理" type="button">
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div className="project-action-menu">
          <button onClick={onRename} type="button"><Pencil aria-hidden="true" size={14} />重命名</button>
          <button className="danger" onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={14} />删除</button>
        </div>
      ) : null}
    </div>
  );
}

function FontPicker({ fonts, onChange, value }: { fonts: SystemFontInfo[]; onChange: (font: SystemFontInfo) => void; value: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const choices = useMemo(() => [{ name: "Microsoft YaHei", path: "", format: "" }, { name: "Source Han Sans SC", path: "", format: "" }, { name: "HarmonyOS Sans", path: "", format: "" }, ...fonts.filter((font) => /yahei|song|hei|kai|fang|han|noto|harmony|alibaba|puhui|dengxian|simsun|simhei/i.test(font.name))], [fonts]);
  const visibleChoices = choices.filter((font) => font.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="font-picker">
      <button aria-expanded={open} className="font-picker-trigger" onClick={() => setOpen((value) => !value)} type="button">
        <span>{value}</span><ChevronDown aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="font-picker-menu">
          <input aria-label="搜索字体" autoFocus onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索字体" value={query} />
          <div className="font-picker-options">
            {visibleChoices.map((font) => (
              <button className={font.name === value ? "selected" : ""} key={`${font.name}-${font.path}`} onClick={() => { onChange(font); setOpen(false); setQuery(""); }} style={{ fontFamily: font.name }} type="button">{font.name}</button>
            ))}
            {visibleChoices.length === 0 ? <span>未找到字体</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StyleResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="style-reset-button" onClick={onClick} title={label} type="button">
      <RotateCcw aria-hidden="true" size={13} />
    </button>
  );
}

function Editor({
  audioPath,
  asrSummary,
  currentProject,
  mediaInfo,
  onExtractAudio,
  onImportVideo,
  onModelChange,
  onExport,
  onScanFonts,
  onRunAsr,
  selectedModel,
  selectedModelId,
  selectedSubtitle,
  subtitleLines,
  subtitleStyle,
  onSubtitleLinesChange,
  onSubtitleStyleChange,
  onUndo,
  onSelectSubtitle,
  systemFonts,
}: {
  audioPath: string | null;
  asrSummary: string | null;
  currentProject: ProjectInfo | null;
  mediaInfo: MediaInfo | null;
  onExtractAudio: () => void;
  onImportVideo: () => void;
  onModelChange: (modelId: string) => void;
  onExport: (format: "srt" | "ass" | "mp4") => void;
  onScanFonts: () => void;
  onRunAsr: () => void;
  selectedModel: (typeof models)[number];
  selectedModelId: string;
  selectedSubtitle: SubtitleLine;
  subtitleLines: SubtitleLine[];
  subtitleStyle: SubtitleStyle;
  onSubtitleLinesChange: (lines: SubtitleLine[]) => void;
  onSubtitleStyleChange: (style: SubtitleStyle) => void;
  onUndo: () => void;
  onSelectSubtitle: (id: string) => void;
  systemFonts: SystemFontInfo[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTimelineUpdateRef = useRef(-Infinity);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exportFormat, setExportFormat] = useState<"srt" | "ass" | "mp4">("mp4");
  const [canvasPresetId, setCanvasPresetId] = useState<CanvasPreset["id"]>("source");
  const [editingSubtitleId, setEditingSubtitleId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [isCanvasEditing, setIsCanvasEditing] = useState(false);
  const [canvasEditingText, setCanvasEditingText] = useState("");
  const mediaSource = mediaInfo ? toMediaUrl(mediaInfo.path) : null;
  const effectiveDuration = duration || mediaInfo?.duration_seconds || 0;
  const hasSubtitles = subtitleLines.length > 0;
  const resetStyle = (values: Partial<SubtitleStyle>) => onSubtitleStyleChange({ ...subtitleStyle, ...values });
  const canvasPreset = canvasPresets.find((preset) => preset.id === canvasPresetId) ?? canvasPresets[0];

  function updateSelectedSubtitle(patch: Partial<SubtitleLine>) {
    if (!hasSubtitles) return;
    onSubtitleLinesChange(
      subtitleLines.map((line) => (line.id === selectedSubtitle.id ? { ...line, ...patch } : line)),
    );
  }

  function beginInlineEdit(subtitle: SubtitleLine) {
    onSelectSubtitle(subtitle.id);
    setEditingSubtitleId(subtitle.id);
    setEditingText(subtitle.text);
  }

  function finishInlineEdit() {
    if (!editingSubtitleId) return;
    const text = editingText.trim();
    if (text) onSubtitleLinesChange(subtitleLines.map((line) => line.id === editingSubtitleId ? { ...line, text } : line));
    setEditingSubtitleId(null);
  }

  function beginCanvasEdit() {
    if (!hasSubtitles) return;
    setCanvasEditingText(selectedSubtitle.text);
    setIsCanvasEditing(true);
  }

  function finishCanvasEdit() {
    const text = canvasEditingText.trim();
    if (text && hasSubtitles) updateSelectedSubtitle({ text });
    setIsCanvasEditing(false);
  }

  function seekTo(seconds: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    lastTimelineUpdateRef.current = seconds;
    setCurrentTime(seconds);
  }

  function seekToSubtitle(subtitle: SubtitleLine) {
    onSelectSubtitle(subtitle.id);
    seekTo(timestampToSeconds(subtitle.start));
  }

  async function togglePlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      await videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  }

  function handleTimeUpdate(seconds: number) {
    if (seconds >= lastTimelineUpdateRef.current && seconds - lastTimelineUpdateRef.current < 0.1) return;
    lastTimelineUpdateRef.current = seconds;
    setCurrentTime(seconds);
    const active = subtitleLines.find(
      (line) => seconds >= timestampToSeconds(line.start) && seconds <= timestampToSeconds(line.end),
    );
    if (active && active.id !== selectedSubtitle.id) onSelectSubtitle(active.id);
  }

  function splitSelectedSubtitle() {
    if (!hasSubtitles) return;
    const start = timestampToMilliseconds(selectedSubtitle.start);
    const end = timestampToMilliseconds(selectedSubtitle.end);
    const text = selectedSubtitle.text.trim();
    if (text.length < 2) return;
    const playhead = Math.round(currentTime * 1000);
    const splitTime = playhead > start + 180 && playhead < end - 180 ? playhead : start + Math.round((end - start) / 2);
    const splitRatio = (splitTime - start) / Math.max(end - start, 1);
    const punctuation = text.search(/[，。！？、,!?]/);
    const splitAt = punctuation > 1 && punctuation < text.length - 1 ? punctuation + 1 : Math.min(text.length - 1, Math.max(1, Math.round(text.length * splitRatio)));
    const leftText = text.slice(0, splitAt).trim();
    const rightText = text.slice(splitAt).trim();
    if (!rightText) return;
    const first = { ...selectedSubtitle, text: leftText, end: formatSubtitleTimestamp(splitTime), health: "good" as const };
    const second: SubtitleLine = {
      ...selectedSubtitle,
      id: `${selectedSubtitle.id}-split-${Date.now()}`,
      text: rightText,
      start: formatSubtitleTimestamp(splitTime),
      end: formatSubtitleTimestamp(end),
      health: "good",
    };
    const result = subtitleLines.flatMap((line) => (line.id === selectedSubtitle.id ? [first, second] : [line]));
    onSubtitleLinesChange(result.map((line, index) => ({ ...line, index: index + 1 })));
    onSelectSubtitle(second.id);
    seekTo(splitTime / 1000);
  }

  function reflowLongSubtitles() {
    const result = subtitleLines.flatMap((line) => {
      const chunks = splitCaptionForReading(line.text, 14);
      if (chunks.length <= 1) return [line];
      const start = timestampToMilliseconds(line.start);
      const end = timestampToMilliseconds(line.end);
      const totalWeight = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      let cursor = start;
      return chunks.map((chunk, index) => {
        const next = index === chunks.length - 1 ? end : cursor + Math.round((end - start) * (chunk.length / totalWeight));
        const segment = { ...line, id: index === 0 ? line.id : `${line.id}-flow-${index}-${Date.now()}`, text: chunk, start: formatSubtitleTimestamp(cursor), end: formatSubtitleTimestamp(next), health: "good" as const };
        cursor = next;
        return segment;
      });
    });
    const normalized = result.map((line, index) => ({ ...line, index: index + 1 }));
    onSubtitleLinesChange(normalized);
    onSelectSubtitle(normalized.find((line) => line.id === selectedSubtitle.id)?.id ?? normalized[0]?.id ?? "");
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        splitSelectedSubtitle();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onUndo();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [currentTime, onUndo, selectedSubtitle, subtitleLines]);

  return (
    <section className="editor-grid">
      <section className="panel subtitle-panel">
        <div className="search-box">
          <Search aria-hidden="true" size={16} />
          <input aria-label="搜索字幕" placeholder="搜索字幕文本" />
        </div>
        <div className="subtitle-list">
          {subtitleLines.length ? subtitleLines.map((subtitle) => (
            <div
              className={`subtitle-row ${selectedSubtitle.id === subtitle.id ? "selected" : ""}`}
              key={subtitle.id}
              onClick={() => seekToSubtitle(subtitle)}
              onDoubleClick={() => beginInlineEdit(subtitle)}
              role="button"
              tabIndex={0}
            >
              <span className="subtitle-index">{subtitle.index}</span>
              <div>
                {editingSubtitleId === subtitle.id ? <textarea aria-label={`编辑字幕 ${subtitle.index}`} autoFocus onBlur={finishInlineEdit} onChange={(event) => setEditingText(event.currentTarget.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setEditingSubtitleId(null); event.currentTarget.blur(); } }} rows={2} value={editingText} /> : <p>{subtitle.text}</p>}
                <span>
                  {subtitle.start} - {subtitle.end}
                </span>
              </div>
              <Badge tone={healthTone[subtitle.health]}>{healthLabel[subtitle.health]}</Badge>
            </div>
          )) : <div className="subtitle-empty">导入媒体后点击“识别字幕”，真实识别结果会显示在这里。</div>}
        </div>
      </section>

      <section className="preview-column">
        <div className="editor-toolbar">
          <Button icon={isPlaying ? Pause : Play} variant="primary" onClick={togglePlayback}>
            {isPlaying ? "暂停" : "播放"}
          </Button>
          <Button icon={RefreshCcw} onClick={reflowLongSubtitles}>重新断句</Button>
          <Button icon={Upload} onClick={onImportVideo}>
            导入
          </Button>
          <Button icon={Waves} onClick={onExtractAudio}>
            提取音频
          </Button>
          <Button icon={Sparkles} onClick={onRunAsr}>
            识别字幕
          </Button>
          <Button icon={Download} onClick={() => onExport(exportFormat)}>导出</Button>
          <div className="canvas-switcher" aria-label="视频画布比例">
            <span>画布</span>
            {canvasPresets.map((preset) => (
              <button
                className={canvasPreset.id === preset.id ? "active" : ""}
                key={preset.id}
                onClick={() => setCanvasPresetId(preset.id)}
                title={`${preset.label} 画布`}
                type="button"
              >
                <i className={`canvas-shape ${preset.id}`} aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
        {currentProject || mediaInfo || audioPath || asrSummary ? (
          <div className="project-context-bar">
            {currentProject ? <span title={currentProject.path}><b>项目</b>{currentProject.name}</span> : null}
            {mediaInfo ? <span title={mediaInfo.path}><b>媒体</b>{mediaInfo.file_name} · {formatDuration(mediaInfo.duration_seconds)} · {mediaInfo.width ?? "--"}×{mediaInfo.height ?? "--"}</span> : null}
            {audioPath ? <span className="ready" title={audioPath}><b>音频</b>已就绪</span> : null}
            {asrSummary ? <span className="ready" title={asrSummary}><b>识别</b>{asrSummary}</span> : null}
          </div>
        ) : null}
        <VideoCanvas
          canvasPreset={canvasPreset}
          captionDraft={canvasEditingText}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          mediaSource={mediaSource}
          sourceAspectRatio={mediaInfo?.width && mediaInfo?.height ? mediaInfo.width / mediaInfo.height : null}
          isCaptionEditing={isCanvasEditing}
          onCaptionDraftChange={setCanvasEditingText}
          onCaptionEditCommit={finishCanvasEdit}
          onCaptionEditStart={beginCanvasEdit}
          onMetadataLoaded={setDuration}
          onPlayToggle={togglePlayback}
          onPlayingChange={setIsPlaying}
          onSeek={seekTo}
          onTimeUpdate={handleTimeUpdate}
          selectedSubtitle={selectedSubtitle}
          style={subtitleStyle}
          videoRef={videoRef}
        />
        <SubtitleTimeline
          audioPath={audioPath}
          currentTime={currentTime}
          duration={effectiveDuration}
          lines={subtitleLines}
          onLinesChange={onSubtitleLinesChange}
          onSeek={seekTo}
          onSelect={onSelectSubtitle}
          onSplit={splitSelectedSubtitle}
          selectedId={selectedSubtitle.id}
        />
      </section>

      <aside className="panel inspector">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Style</p>
            <h3>字幕样式</h3>
          </div>
          <StyleResetButton label="重置全部字幕样式" onClick={() => onSubtitleStyleChange(defaultSubtitleStyle)} />
        </div>
        <div className="field-with-action">
          <label>
            字体
            <FontPicker fonts={systemFonts} onChange={(font) => onSubtitleStyleChange({ ...subtitleStyle, fontFamily: font.name, fontPath: font.path || undefined })} value={subtitleStyle.fontFamily} />
          </label>
          <Button icon={RefreshCcw} onClick={onScanFonts}>
            扫描
          </Button>
        </div>
        <section className="style-group">
          <div className="style-group-head"><span>字号</span><output>{subtitleStyle.fontSize}px</output><StyleResetButton label="重置字体与字号" onClick={() => resetStyle({ fontFamily: defaultSubtitleStyle.fontFamily, fontSize: defaultSubtitleStyle.fontSize })} /></div>
          <div className="size-control">
            <input aria-label="字号滑杆" max="160" min="16" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, fontSize: Number(event.currentTarget.value) })} step="1" type="range" value={subtitleStyle.fontSize} />
            <input aria-label="字号" inputMode="numeric" max="160" min="16" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, fontSize: Math.min(160, Math.max(16, Number(event.currentTarget.value) || 16)) })} value={subtitleStyle.fontSize} />
          </div>
          <div className="size-presets">
            {[32, 48, 64, 96].map((size) => <button className={subtitleStyle.fontSize === size ? "active" : ""} key={size} onClick={() => onSubtitleStyleChange({ ...subtitleStyle, fontSize: size })} type="button">{size}</button>)}
          </div>
        </section>
        <section className="style-group">
          <div className="style-group-head"><span>字面</span><StyleResetButton label="重置填充颜色" onClick={() => resetStyle({ color: defaultSubtitleStyle.color })} /></div>
          <ColorControl label="填充颜色" value={subtitleStyle.color} onChange={(color) => onSubtitleStyleChange({ ...subtitleStyle, color })} />
        </section>
        <section className="style-group">
          <div className="style-group-head"><span>描边</span><output>{subtitleStyle.strokeWidth}px</output><StyleResetButton label="重置描边设置" onClick={() => resetStyle({ strokeColor: defaultSubtitleStyle.strokeColor, strokeMode: defaultSubtitleStyle.strokeMode, strokeWidth: defaultSubtitleStyle.strokeWidth })} /></div>
          <div aria-label="描边位置" className="segmented-control">
            <button className={subtitleStyle.strokeMode === "outer" ? "active" : ""} onClick={() => onSubtitleStyleChange({ ...subtitleStyle, strokeMode: "outer" })} type="button">外描</button>
            <button className={subtitleStyle.strokeMode === "inner" ? "active" : ""} onClick={() => onSubtitleStyleChange({ ...subtitleStyle, strokeMode: "inner" })} type="button">内描</button>
          </div>
          <div className="stroke-control">
            <input aria-label="描边粗细" max="12" min="0" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, strokeWidth: Number(event.currentTarget.value) })} step="0.5" type="range" value={subtitleStyle.strokeWidth} />
            <input aria-label="描边粗细数值" inputMode="decimal" max="12" min="0" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, strokeWidth: Math.min(12, Math.max(0, Number(event.currentTarget.value) || 0)) })} value={subtitleStyle.strokeWidth} />
          </div>
          <ColorControl label="描边颜色" value={subtitleStyle.strokeColor} onChange={(strokeColor) => onSubtitleStyleChange({ ...subtitleStyle, strokeColor })} />
        </section>
        <section className="style-group">
          <div className="style-group-head"><span>位置与透明度</span><output>{Math.round(subtitleStyle.opacity * 100)}%</output><StyleResetButton label="重置位置与透明度" onClick={() => resetStyle({ opacity: defaultSubtitleStyle.opacity, positionX: defaultSubtitleStyle.positionX, positionY: defaultSubtitleStyle.positionY })} /></div>
          <label className="position-control">水平位置
            <input aria-label="字幕水平位置" max="40" min="-40" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, positionX: Number(event.currentTarget.value) })} type="range" value={subtitleStyle.positionX} />
          </label>
          <label className="position-control">垂直位置
            <input aria-label="字幕垂直位置" max="80" min="2" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, positionY: Number(event.currentTarget.value) })} type="range" value={subtitleStyle.positionY} />
          </label>
          <label className="position-control">透明度
            <input aria-label="字幕透明度" max="1" min="0.1" onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, opacity: Number(event.currentTarget.value) })} step="0.05" type="range" value={subtitleStyle.opacity} />
          </label>
        </section>
        <div className="inspector-card">
          <p>当前字幕</p>
          <strong>{hasSubtitles ? selectedSubtitle.text : "暂无识别字幕"}</strong>
          <span>{hasSubtitles ? `置信度 ${(selectedSubtitle.confidence * 100).toFixed(0)}%` : "识别完成后可编辑文本与时间"}</span>
        </div>

        <div className="subtitle-edit-section">
          <div className="tool-section-head">
            <div>
              <p className="eyebrow">Caption</p>
              <h3>字幕编辑</h3>
            </div>
            <span className="subtitle-number">{hasSubtitles ? `#${selectedSubtitle.index}` : "--"}</span>
          </div>
          <textarea aria-label="字幕文本" disabled={!hasSubtitles} placeholder="识别结果将在这里显示" value={selectedSubtitle.text} onChange={(event) => updateSelectedSubtitle({ text: event.currentTarget.value })} />
          <div className="time-fields">
            <label>开始<input disabled={!hasSubtitles} value={selectedSubtitle.start} onChange={(event) => updateSelectedSubtitle({ start: event.currentTarget.value })} /></label>
            <label>结束<input disabled={!hasSubtitles} value={selectedSubtitle.end} onChange={(event) => updateSelectedSubtitle({ end: event.currentTarget.value })} /></label>
          </div>
        </div>

        <div className="tool-section">
          <div className="tool-section-head">
            <div>
              <p className="eyebrow">Qwen3-ASR</p>
              <h3>识别模型</h3>
            </div>
          </div>
          <label>
            模型
            <select value={selectedModelId} onChange={(event) => onModelChange(event.currentTarget.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <div className="model-confirm">
            <Badge tone={selectedModel.status === "installed" ? "success" : "warning"}>
              {selectedModel.status === "installed" ? "已安装" : "未下载"}
            </Badge>
            <span>{selectedModel.purpose}</span>
          </div>
        </div>

        <div className="tool-section">
          <div className="tool-section-head">
            <div>
              <p className="eyebrow">Export</p>
              <h3>导出</h3>
            </div>
          </div>
          <label>
            输出格式
            <select onChange={(event) => setExportFormat(event.currentTarget.value as "srt" | "ass" | "mp4")} value={exportFormat}>
              <option value="mp4">带字幕 MP4</option>
              <option value="srt">SRT 字幕</option>
              <option value="ass">ASS 样式字幕</option>
            </select>
          </label>
          <Button icon={Download} onClick={() => onExport(exportFormat)} variant="primary">
            开始导出
          </Button>
        </div>
      </aside>
    </section>
  );
}

function ColorControl({ label, onChange, value }: { label: string; onChange: (color: string) => void; value: string }) {
  return (
    <label className="color-control">
      <span>{label}</span>
      <div>
        <input aria-label={`${label}色板`} onChange={(event) => onChange(event.currentTarget.value.toUpperCase())} type="color" value={value} />
        <input aria-label={`${label}十六进制`} onChange={(event) => onChange(event.currentTarget.value)} value={value} />
      </div>
    </label>
  );
}

function formatDuration(seconds?: number | null) {
  if (!seconds) {
    return "--:--";
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

function cleanCaptionText(text: string) {
  return text
    .replace(/[，。！？；：、,.!?;:"'“”‘’()（）\[\]【】{}<>《》…—–\-·~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCaptionForReading(text: string, maximumLength: number) {
  const normalized = text.replace(/\s+/g, "").trim();
  if (normalized.length <= maximumLength) return normalized ? [normalized] : [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maximumLength) {
    const window = remaining.slice(0, maximumLength + 1);
    const breakpoint = Math.max(window.lastIndexOf("，"), window.lastIndexOf("。"), window.lastIndexOf("、"), window.lastIndexOf(","), window.lastIndexOf(" "));
    const end = breakpoint >= Math.floor(maximumLength * 0.55) ? breakpoint + 1 : maximumLength;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function timestampToMilliseconds(timestamp: string) {
  const [hours = "0", minutes = "0", seconds = "0"] = timestamp.split(":");
  return Math.max(0, (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
}

function timestampToSeconds(timestamp: string) {
  return timestampToMilliseconds(timestamp) / 1000;
}

function formatSubtitleTimestamp(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const rest = total % 1_000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${rest.toString().padStart(3, "0")}`;
}

function resolveSubtitleOverlaps(lines: SubtitleLine[]) {
  const minimumDuration = 120;
  const ordered = [...lines].sort((left, right) => timestampToMilliseconds(left.start) - timestampToMilliseconds(right.start));
  const normalized = ordered.map((line) => ({ ...line }));
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const previousStart = timestampToMilliseconds(previous.start);
    const previousEnd = timestampToMilliseconds(previous.end);
    const currentStart = timestampToMilliseconds(current.start);
    const currentEnd = timestampToMilliseconds(current.end);
    if (currentStart >= previousEnd) continue;
    const midpoint = Math.round((currentStart + previousEnd) / 2);
    const boundary = Math.max(previousStart + minimumDuration, Math.min(midpoint, currentEnd - 1));
    previous.end = formatSubtitleTimestamp(boundary);
    current.start = formatSubtitleTimestamp(boundary);
    if (currentEnd <= boundary) current.end = formatSubtitleTimestamp(boundary + minimumDuration);
  }
  return normalized.map((line, index) => ({ ...line, index: index + 1 }));
}

function SettingsView({
  appSettings,
  appStatus,
  onInstallDefaultModels,
  onRefreshEnvironment,
  onSave,
}: {
  appSettings: AppSettings | null;
  appStatus: AppStatus | null;
  onInstallDefaultModels: () => void;
  onRefreshEnvironment: () => void;
  onSave: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState<AppSettings>({
    project_dir: appSettings?.project_dir ?? "",
    default_model: appSettings?.default_model ?? "qwen3-asr-06b",
    auto_save_seconds: appSettings?.auto_save_seconds ?? 3,
    python_path: appSettings?.python_path ?? "",
  });
  const [isQrExpanded, setIsQrExpanded] = useState(false);

  useEffect(() => {
    if (appSettings) setDraft(appSettings);
  }, [appSettings]);

  const model = models.find((item) => item.id === draft.default_model) ?? models[0];
  async function selectProjectDirectory() {
    const directory = await chooseProjectDirectory();
    if (directory) setDraft((current) => ({ ...current, project_dir: directory }));
  }
  async function selectPythonExecutable() {
    const executable = await choosePythonExecutable();
    if (executable) setDraft((current) => ({ ...current, python_path: executable }));
  }

  return (
    <section className="settings-layout">
      <section className="panel form-panel settings-form">
        <div>
          <p className="eyebrow">Preferences</p>
          <h3>本地工作区</h3>
        </div>
        <label>
          默认项目目录
          <div className="settings-path-field">
            <input onChange={(event) => setDraft((current) => ({ ...current, project_dir: event.currentTarget.value }))} value={draft.project_dir} />
            <Button icon={FolderOpen} onClick={selectProjectDirectory}>选择</Button>
          </div>
        </label>
        <label>
          默认识别模型
          <select onChange={(event) => setDraft((current) => ({ ...current, default_model: event.currentTarget.value }))} value={draft.default_model}>
            {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="settings-model-summary">
          <strong>{model.name}</strong><span>{model.purpose}</span><span>{model.size} · {model.hardware}</span>
        </div>
        <label>
          自动保存间隔
          <select onChange={(event) => setDraft((current) => ({ ...current, auto_save_seconds: Number(event.currentTarget.value) }))} value={draft.auto_save_seconds}>
            <option value="1">1 秒</option><option value="3">3 秒</option><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option>
          </select>
        </label>
        {appStatus?.embedded_runtime ? (
          <div className="settings-note">已使用软件内置 Python 运行时，无需安装 Python 或任何识别依赖。</div>
        ) : <label>
          Python Worker
          <div className="settings-path-field">
            <input onChange={(event) => setDraft((current) => ({ ...current, python_path: event.currentTarget.value }))} placeholder="仅开发版可指定外部 Python" value={draft.python_path ?? ""} />
            <Button icon={FolderOpen} onClick={selectPythonExecutable}>选择</Button>
          </div>
        </label>}
        <Button variant="primary" onClick={() => onSave(draft)}>保存设置</Button>
      </section>

      <section className="panel environment-panel">
        <div className="environment-heading">
          <div>
          <p className="eyebrow">Environment</p>
          <h3>本地运行环境</h3>
          </div>
          <Button icon={RefreshCcw} onClick={onRefreshEnvironment} variant="ghost">重新检测</Button>
        </div>
        <EnvironmentRow label="Python" path={appStatus?.python_path} status={appStatus?.python} />
        <div className="environment-row"><span>离线识别包</span><strong>{appStatus?.embedded_runtime ? "内置 Python 已就绪" : "开发模式"}</strong></div>
        <EnvironmentRow label="默认模型权重" path={appStatus?.model_path ?? undefined} status={appStatus?.model} />
        <EnvironmentRow label="FFmpeg 8.0" path={appStatus?.ffmpeg_path} status={appStatus?.ffmpeg} />
        <EnvironmentRow label="FFprobe" status={appStatus?.ffprobe} />
        <div className="environment-row">
          <span>系统字体</span><strong>{appStatus ? `${appStatus.system_font_count} 个文件` : "检测中"}</strong>
        </div>
        <div className="environment-actions">
          {!appStatus?.model?.available ? <Button icon={Download} onClick={onInstallDefaultModels} variant="primary">下载默认模型</Button> : null}
          <Button icon={Download} onClick={() => void openUrl("https://www.python.org/downloads/windows/")}>Python 官方下载</Button>
          <Button icon={Download} onClick={() => void openUrl("https://www.gyan.dev/ffmpeg/builds/")}>FFmpeg 官方构建</Button>
        </div>
        <div className="settings-note">FFmpeg 8.0 已随软件安装并由 CaptionFlow 直接调用，不依赖系统 PATH。默认模型会下载到 {`%LOCALAPPDATA%\\CaptionFlow\\models`}，安装完成后可离线识别。</div>
      </section>
      <section className="panel about-panel">
        <div>
          <p className="eyebrow">About</p>
          <h3>版权与开源信息</h3>
        </div>
        <div className="about-content">
          <div>
            <div className="about-grid">
              <div><span>软件名称</span><strong>CaptionFlow 本地智能字幕</strong></div>
              <div><span>作者</span><strong>齐世有</strong></div>
              <div><span>联系邮箱</span><a href="mailto:blacklaw@foxmail.com">blacklaw@foxmail.com</a></div>
              <div><span>版权</span><strong>Copyright © 2026 齐世有</strong></div>
            </div>
            <p className="open-source-note">开源组件：Tauri、React、Rust、FFmpeg、Qwen3-ASR。各组件遵循其各自的开源许可证。</p>
          </div>
          <button aria-label="放大联系二维码" className="about-qr" onClick={() => setIsQrExpanded(true)} title="点击放大二维码" type="button"><img alt="联系二维码" src="/weichat-qr.svg" /></button>
        </div>
        {isQrExpanded ? <div className="qr-lightbox" onClick={() => setIsQrExpanded(false)} role="presentation"><img alt="联系二维码" onClick={(event) => event.stopPropagation()} src="/weichat-qr.svg" /></div> : null}
      </section>
    </section>
  );
}

function EnvironmentRow({ label, path, status }: { label: string; path?: string; status?: { available: boolean; version?: string | null } }) {
  return <div className="environment-row"><span>{label}</span><div><Badge tone={status?.available ? "success" : "danger"}>{status?.available ? "可用" : "未检测"}</Badge><strong title={path ?? status?.version ?? ""}>{status?.version ?? path ?? "--"}</strong></div></div>;
}

export default App;
