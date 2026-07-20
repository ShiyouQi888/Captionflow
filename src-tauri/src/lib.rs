use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
struct ToolStatus {
    available: bool,
    version: Option<String>,
}

#[derive(Serialize)]
struct AppStatus {
    default_project_dir: String,
    ffmpeg: ToolStatus,
    ffprobe: ToolStatus,
    ffmpeg_path: String,
    python: ToolStatus,
    python_path: String,
    embedded_runtime: bool,
    embedded_model: bool,
    model: ToolStatus,
    model_path: Option<String>,
    system_font_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppSettings {
    project_dir: String,
    default_model: String,
    auto_save_seconds: u32,
    python_path: Option<String>,
}

#[derive(Serialize)]
struct ProjectInfo {
    name: String,
    path: String,
    created_at: u64,
}

#[derive(Serialize)]
struct OpenProjectResult {
    project: ProjectInfo,
    media_path: Option<String>,
    subtitles: Value,
}

#[derive(Serialize)]
struct FontInfo {
    name: String,
    path: String,
    format: String,
}

#[derive(Serialize)]
struct MediaInfo {
    path: String,
    file_name: String,
    duration_seconds: Option<f64>,
    width: Option<u64>,
    height: Option<u64>,
    frame_rate: Option<String>,
    audio_streams: usize,
    video_streams: usize,
}

#[derive(Serialize)]
struct AudioExtractResult {
    audio_path: String,
}

#[derive(Serialize)]
struct AsrRunResult {
    output_path: String,
    subtitles_path: Option<String>,
    payload: Value,
}

#[derive(Serialize)]
struct ModelInstallResult {
    model_path: String,
    aligner_path: String,
}

#[derive(Serialize)]
struct ExportResult {
    output_path: String,
    format: String,
}

#[derive(Deserialize)]
struct CreateProjectRequest {
    name: String,
    base_dir: Option<String>,
}

#[derive(Deserialize)]
struct RenameProjectRequest {
    path: String,
    name: String,
}

#[derive(Deserialize)]
struct RunAsrRequest {
    audio_path: String,
    project_path: String,
    language: Option<String>,
    mode: Option<String>,
    model_path: Option<String>,
    aligner_path: Option<String>,
}

#[derive(Deserialize)]
struct SaveSubtitlesRequest {
    project_path: String,
    subtitles: Value,
}

#[derive(Deserialize)]
struct SaveSettingsRequest {
    project_dir: String,
    default_model: String,
    auto_save_seconds: u32,
    python_path: Option<String>,
}

#[derive(Deserialize)]
struct ExportStyle {
    font_family: String,
    font_size: f64,
    color: String,
    stroke_color: String,
    stroke_width: f64,
    opacity: f64,
    position_x: f64,
    position_y: f64,
}

#[derive(Deserialize)]
struct ExportRequest {
    project_path: String,
    source_path: Option<String>,
    output_path: Option<String>,
    format: String,
    subtitles: Value,
    style: ExportStyle,
    video_width: Option<u64>,
    video_height: Option<u64>,
}

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| error.to_string())
}

fn captionflow_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(user_profile) = env::var("USERPROFILE") {
            return PathBuf::from(user_profile)
                .join("Documents")
                .join("CaptionFlow");
        }
    }

    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("CaptionFlow")
}

fn default_project_dir() -> PathBuf {
    captionflow_dir().join("projects")
}

fn settings_path() -> PathBuf {
    captionflow_dir().join("settings.json")
}

fn default_settings() -> AppSettings {
    AppSettings {
        project_dir: default_project_dir().to_string_lossy().to_string(),
        default_model: "qwen3-asr-06b".to_string(),
        auto_save_seconds: 3,
        python_path: None,
    }
}

fn load_settings() -> AppSettings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(default_settings)
}

fn save_settings_file(settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(captionflow_dir()).map_err(|error| error.to_string())?;
    fs::write(
        settings_path(),
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn worker_script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("python").join("asr_worker.py"));
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("python").join("asr_worker.py"));
        candidates.push(current_dir.join("..").join("python").join("asr_worker.py"));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("python").join("asr_worker.py"));
            candidates.push(parent.join("..").join("python").join("asr_worker.py"));
            candidates.push(parent.join("..").join("..").join("python").join("asr_worker.py"));
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate.canonicalize().map_err(|error| error.to_string());
        }
    }

    Err("未找到 Qwen3-ASR Worker：python/asr_worker.py".to_string())
}

fn bundled_runtime_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let runtime_root = resource_dir.join("runtime").join("python");
    runtime_root.join("python.exe").is_file().then_some(runtime_root)
}

fn bundled_model_path(app: &tauri::AppHandle, model_name: &str) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let model_path = resource_dir.join("models").join(model_name);
    model_path.is_dir().then_some(model_path)
}

fn bundled_ffmpeg_binary(app: &tauri::AppHandle, binary: &str) -> Option<PathBuf> {
    let file_name = format!("{binary}.exe");
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("ffmpeg").join("8.0").join("bin").join(&file_name));
    }
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("tools").join("ffmpeg").join("8.0").join("bin").join(&file_name));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn ffmpeg_binary(app: &tauri::AppHandle, binary: &str) -> String {
    bundled_ffmpeg_binary(app, binary)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| binary.to_string())
}

fn managed_models_dir() -> PathBuf {
    captionflow_dir().join("models")
}

fn managed_model_path(model_name: &str) -> Option<PathBuf> {
    let model_path = managed_models_dir().join(model_name);
    model_path.is_dir().then_some(model_path)
}

fn python_binary(app: Option<&tauri::AppHandle>) -> String {
    if let Some(runtime_root) = app.and_then(bundled_runtime_root) {
        return runtime_root.join("python.exe").to_string_lossy().to_string();
    }
    load_settings()
        .python_path
        .filter(|path| !path.trim().is_empty())
        .or_else(|| env::var("CAPTIONFLOW_PYTHON").ok())
        .unwrap_or_else(|| "python".to_string())
}

fn background_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn concise_process_error(stderr: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr);
    let details = stderr_text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .rev()
        .take(8)
        .collect::<Vec<_>>();
    let message = details.into_iter().rev().collect::<Vec<_>>().join("\n");
    if message.chars().count() > 1800 {
        message.chars().take(1800).collect::<String>() + "\n（错误日志已截断）"
    } else {
        message
    }
}

fn sanitize_file_name(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let cleaned = name
        .chars()
        .map(|ch| if invalid.contains(&ch) { '_' } else { ch })
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        "未命名项目".to_string()
    } else {
        cleaned
    }
}

fn command_status(binary: &str) -> ToolStatus {
    match background_command(binary).arg("-version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().map(|line| line.to_string());
            ToolStatus {
                available: true,
                version,
            }
        }
        _ => ToolStatus {
            available: false,
            version: None,
        },
    }
}

fn python_status(binary: &str) -> ToolStatus {
    match background_command(binary).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            ToolStatus {
                available: true,
                version: stdout.lines().next().or_else(|| stderr.lines().next()).map(|line| line.to_string()),
            }
        }
        _ => ToolStatus { available: false, version: None },
    }
}

fn system_font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if cfg!(windows) {
        dirs.push(PathBuf::from(r"C:\Windows\Fonts"));
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local_app_data).join("Microsoft").join("Windows").join("Fonts"));
        }
    } else if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/System/Library/Fonts"));
        dirs.push(PathBuf::from("/Library/Fonts"));
        if let Ok(home) = env::var("HOME") {
            dirs.push(PathBuf::from(home).join("Library").join("Fonts"));
        }
    } else {
        dirs.push(PathBuf::from("/usr/share/fonts"));
        if let Ok(home) = env::var("HOME") {
            dirs.push(PathBuf::from(home).join(".local").join("share").join("fonts"));
        }
    }

    dirs
}

fn scan_font_files() -> Vec<FontInfo> {
    let mut fonts = Vec::new();
    let extensions = ["ttf", "otf", "ttc"];

    for dir in system_font_dirs() {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };

            if !extensions.iter().any(|item| item.eq_ignore_ascii_case(extension)) {
                continue;
            }

            let name = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Unknown Font")
                .to_string();

            fonts.push(FontInfo {
                name,
                path: path.to_string_lossy().to_string(),
                format: extension.to_uppercase(),
            });
        }
    }

    fonts.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    fonts
}

#[tauri::command]
fn get_app_status(app: tauri::AppHandle) -> AppStatus {
    let settings = load_settings();
    let python_path = python_binary(Some(&app));
    let ffmpeg_path = ffmpeg_binary(&app, "ffmpeg");
    let ffprobe_path = ffmpeg_binary(&app, "ffprobe");
    AppStatus {
        default_project_dir: settings.project_dir,
        ffmpeg: command_status(&ffmpeg_path),
        ffprobe: command_status(&ffprobe_path),
        ffmpeg_path,
        python: python_status(&python_path),
        python_path,
        embedded_runtime: bundled_runtime_root(&app).is_some(),
        embedded_model: bundled_model_path(&app, "Qwen3-ASR-0.6B").is_some(),
        model: ToolStatus {
            available: bundled_model_path(&app, "Qwen3-ASR-0.6B").is_some() || managed_model_path("Qwen3-ASR-0.6B").is_some(),
            version: Some("Qwen3-ASR-0.6B".to_string()),
        },
        model_path: bundled_model_path(&app, "Qwen3-ASR-0.6B")
            .or_else(|| managed_model_path("Qwen3-ASR-0.6B"))
            .map(|path| path.to_string_lossy().to_string()),
        system_font_count: scan_font_files().len(),
    }
}

#[tauri::command]
fn get_settings() -> AppSettings {
    load_settings()
}

#[tauri::command]
fn save_settings(request: SaveSettingsRequest) -> Result<AppSettings, String> {
    let project_dir = PathBuf::from(request.project_dir.trim());
    if project_dir.as_os_str().is_empty() {
        return Err("项目目录不能为空".to_string());
    }
    fs::create_dir_all(&project_dir).map_err(|error| format!("无法创建项目目录：{error}"))?;
    let settings = AppSettings {
        project_dir: project_dir.to_string_lossy().to_string(),
        default_model: request.default_model,
        auto_save_seconds: request.auto_save_seconds.clamp(1, 60),
        python_path: request.python_path.filter(|path| !path.trim().is_empty()),
    };
    save_settings_file(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn scan_system_fonts() -> Vec<FontInfo> {
    scan_font_files()
}

#[tauri::command]
fn create_project(request: CreateProjectRequest) -> Result<ProjectInfo, String> {
    let base_dir = request
        .base_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(load_settings().project_dir));
    let requested_name = sanitize_file_name(&request.name);
    let mut safe_name = requested_name.clone();
    let mut project_dir = base_dir.join(&safe_name);
    let mut suffix = 2_u32;
    while project_dir.exists() {
        safe_name = format!("{requested_name} {suffix}");
        project_dir = base_dir.join(&safe_name);
        suffix += 1;
    }

    fs::create_dir_all(project_dir.join("source")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("audio")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("subtitles")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("styles")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("fonts")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("cache").join("thumbnails")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("exports")).map_err(|error| error.to_string())?;

    let created_at = now_unix_seconds()?;
    let project = ProjectInfo {
        name: safe_name,
        path: project_dir.to_string_lossy().to_string(),
        created_at,
    };

    let project_json = serde_json::json!({
        "name": project.name,
        "path": project.path,
        "created_at": project.created_at,
        "version": 1,
        "media": null,
        "subtitles": [],
        "style": {
            "font_family": "Microsoft YaHei",
            "font_size": 48,
            "color": "#FFFFFF",
            "stroke_color": "#000000",
            "stroke_width": 4
        }
    });

    fs::write(
        project_dir.join("project.json"),
        serde_json::to_string_pretty(&project_json).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_project_manifest(&project_dir, &project, None)?;

    Ok(project)
}

fn write_project_manifest(project_dir: &Path, project: &ProjectInfo, media_path: Option<String>) -> Result<(), String> {
    let manifest = serde_json::json!({
        "format": "CaptionFlowProject",
        "version": 1,
        "project": { "name": project.name, "path": project.path, "created_at": project.created_at },
        "media_path": media_path,
        "subtitles_path": "subtitles/subtitles.json"
    });
    fs::write(project_dir.join("project.captionflow"), serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_project_media(project_path: String, media_path: String) -> Result<(), String> {
    let project_dir = PathBuf::from(&project_path);
    let metadata: Value = serde_json::from_str(&fs::read_to_string(project_dir.join("project.json")).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let project = ProjectInfo {
        name: metadata.get("name").and_then(Value::as_str).unwrap_or("未命名字幕项目").to_string(),
        path: project_path,
        created_at: metadata.get("created_at").and_then(Value::as_u64).unwrap_or(0),
    };
    write_project_manifest(&project_dir, &project, Some(media_path))
}

#[tauri::command]
fn open_project_file(path: String) -> Result<OpenProjectResult, String> {
    let file = PathBuf::from(&path);
    if file.extension().and_then(|extension| extension.to_str()) != Some("captionflow") {
        return Err("请选择 CaptionFlow 工程文件（.captionflow）".to_string());
    }
    let manifest: Value = serde_json::from_str(&fs::read_to_string(&file).map_err(|error| error.to_string())?)
        .map_err(|_| "工程文件格式无效".to_string())?;
    if manifest.get("format").and_then(Value::as_str) != Some("CaptionFlowProject") {
        return Err("这不是 CaptionFlow 工程文件".to_string());
    }
    let project_dir = file.parent().ok_or_else(|| "工程文件路径无效".to_string())?;
    let project_data = manifest.get("project").ok_or_else(|| "工程缺少项目信息".to_string())?;
    let project = ProjectInfo {
        name: project_data.get("name").and_then(Value::as_str).unwrap_or("未命名字幕项目").to_string(),
        path: project_dir.to_string_lossy().to_string(),
        created_at: project_data.get("created_at").and_then(Value::as_u64).unwrap_or(0),
    };
    let subtitles_path = manifest.get("subtitles_path").and_then(Value::as_str).unwrap_or("subtitles/subtitles.json");
    let subtitles = fs::read_to_string(project_dir.join(subtitles_path))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(|| Value::Array(Vec::new()));
    Ok(OpenProjectResult { project, media_path: manifest.get("media_path").and_then(Value::as_str).map(str::to_string), subtitles })
}

#[tauri::command]
fn rename_project(request: RenameProjectRequest) -> Result<ProjectInfo, String> {
    let current = PathBuf::from(&request.path);
    if !current.join("project.json").is_file() {
        return Err("项目目录无效，无法重命名".to_string());
    }
    let name = sanitize_file_name(&request.name);
    let parent = current.parent().ok_or_else(|| "项目目录无效".to_string())?;
    let destination = parent.join(&name);
    if destination.exists() {
        return Err("同名项目已存在".to_string());
    }
    fs::rename(&current, &destination).map_err(|error| format!("重命名项目失败：{error}"))?;
    let created_at = fs::metadata(&destination)
        .and_then(|metadata| metadata.created())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_else(|| now_unix_seconds().unwrap_or(0));
    let project = ProjectInfo { name, path: destination.to_string_lossy().to_string(), created_at };
    let metadata_path = destination.join("project.json");
    if let Ok(contents) = fs::read_to_string(&metadata_path) {
        if let Ok(mut metadata) = serde_json::from_str::<Value>(&contents) {
            metadata["name"] = Value::String(project.name.clone());
            metadata["path"] = Value::String(project.path.clone());
            fs::write(&metadata_path, serde_json::to_string_pretty(&metadata).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        }
    }
    let previous_manifest = fs::read_to_string(destination.join("project.captionflow"))
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok());
    let media_path = previous_manifest.and_then(|manifest| manifest.get("media_path").and_then(Value::as_str).map(str::to_string));
    write_project_manifest(&destination, &project, media_path)?;
    Ok(project)
}

#[tauri::command]
fn delete_project(path: String) -> Result<(), String> {
    let project = PathBuf::from(path);
    if !project.join("project.json").is_file() {
        return Err("项目目录无效，无法删除".to_string());
    }
    fs::remove_dir_all(&project).map_err(|error| format!("删除项目失败：{error}"))
}

fn parse_frame_rate(raw: Option<&str>) -> Option<String> {
    let value = raw?;
    if value == "0/0" {
        return None;
    }
    Some(value.to_string())
}

#[tauri::command]
fn probe_media(app: tauri::AppHandle, path: String) -> Result<MediaInfo, String> {
    let media_path = Path::new(&path);
    if !media_path.exists() {
        return Err("文件不存在".to_string());
    }

    let ffprobe = ffmpeg_binary(&app, "ffprobe");
    let output = background_command(&ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|error| format!("无法运行 ffprobe：{error}"))?;

    if !output.status.success() {
        return Err(format!("ffprobe 读取失败：{}", concise_process_error(&output.stderr)));
    }

    let json: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let streams = json
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let video_streams: Vec<&Value> = streams
        .iter()
        .filter(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("video"))
        .collect();
    let audio_streams = streams
        .iter()
        .filter(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("audio"))
        .count();

    let first_video = video_streams.first().copied();
    let duration_seconds = json
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok());

    Ok(MediaInfo {
        path: path.clone(),
        file_name: media_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("unknown")
            .to_string(),
        duration_seconds,
        width: first_video
            .and_then(|stream| stream.get("width"))
            .and_then(|value| value.as_u64()),
        height: first_video
            .and_then(|stream| stream.get("height"))
            .and_then(|value| value.as_u64()),
        frame_rate: parse_frame_rate(
            first_video
                .and_then(|stream| stream.get("avg_frame_rate"))
                .and_then(|value| value.as_str()),
        ),
        audio_streams,
        video_streams: video_streams.len(),
    })
}

#[tauri::command]
fn extract_audio(app: tauri::AppHandle, source_path: String, project_path: String) -> Result<AudioExtractResult, String> {
    let source = Path::new(&source_path);
    let project = Path::new(&project_path);

    if !source.exists() {
        return Err("源媒体文件不存在".to_string());
    }

    if !project.exists() {
        return Err("项目目录不存在".to_string());
    }

    let audio_dir = project.join("audio");
    fs::create_dir_all(&audio_dir).map_err(|error| error.to_string())?;
    let audio_path = audio_dir.join("audio.wav");

    let ffmpeg = ffmpeg_binary(&app, "ffmpeg");
    let output = background_command(&ffmpeg)
        .args([
            "-y",
            "-i",
            &source_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            audio_path
                .to_str()
                .ok_or_else(|| "音频输出路径无效".to_string())?,
        ])
        .output()
        .map_err(|error| format!("无法运行 ffmpeg：{error}"))?;

    if !output.status.success() {
        return Err(format!("音频提取失败：{}", concise_process_error(&output.stderr)));
    }

    Ok(AudioExtractResult {
        audio_path: audio_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn read_audio_waveform(audio_path: String, buckets: usize) -> Result<Vec<f32>, String> {
    let bytes = fs::read(&audio_path).map_err(|error| format!("无法读取音频文件：{error}"))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("音频不是有效的 WAV 文件".to_string());
    }

    let mut cursor = 12usize;
    let mut channels = 1u16;
    let mut bits_per_sample = 16u16;
    let mut data: Option<&[u8]> = None;
    while cursor + 8 <= bytes.len() {
        let chunk_id = &bytes[cursor..cursor + 4];
        let chunk_size = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
        let content_start = cursor + 8;
        let content_end = content_start.saturating_add(chunk_size).min(bytes.len());
        if chunk_id == b"fmt " && content_end >= content_start + 16 {
            channels = u16::from_le_bytes(bytes[content_start + 2..content_start + 4].try_into().unwrap());
            bits_per_sample = u16::from_le_bytes(bytes[content_start + 14..content_start + 16].try_into().unwrap());
        } else if chunk_id == b"data" {
            data = Some(&bytes[content_start..content_end]);
            break;
        }
        cursor = content_start.saturating_add(chunk_size).saturating_add(chunk_size % 2);
    }

    if channels != 1 || bits_per_sample != 16 {
        return Err("波形仅支持 16 位单声道 WAV".to_string());
    }
    let data = data.ok_or_else(|| "WAV 文件缺少音频数据".to_string())?;
    let samples: Vec<f32> = data
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f32 / i16::MAX as f32)
        .collect();
    if samples.is_empty() {
        return Err("音频中没有可用采样".to_string());
    }

    let count = buckets.clamp(256, 8_192);
    let bucket_size = (samples.len() + count - 1) / count;
    let mut waveform = Vec::with_capacity(count);
    for index in 0..count {
        let start = index * bucket_size;
        let end = (start + bucket_size).min(samples.len());
        if start >= end {
            waveform.push(0.0);
            continue;
        }
        let peak = samples[start..end].iter().fold(0.0f32, |maximum, sample| maximum.max(sample.abs()));
        waveform.push(peak);
    }
    let maximum = waveform.iter().copied().fold(0.0f32, f32::max);
    if maximum > 0.0 {
        for value in &mut waveform {
            *value = (*value / maximum).powf(0.72).clamp(0.0, 1.0);
        }
    }
    Ok(waveform)
}

#[tauri::command]
fn run_qwen_asr(app: tauri::AppHandle, request: RunAsrRequest) -> Result<AsrRunResult, String> {
    let audio_path = Path::new(&request.audio_path);
    let project_path = Path::new(&request.project_path);

    if !audio_path.exists() {
        return Err("音频文件不存在，请先提取音频".to_string());
    }

    if !project_path.exists() {
        return Err("项目目录不存在".to_string());
    }

    let worker_path = worker_script_path(&app)?;
    let cache_dir = project_path.join("cache");
    let subtitles_dir = project_path.join("subtitles");
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&subtitles_dir).map_err(|error| error.to_string())?;

    let request_path = cache_dir.join("qwen_asr_request.json");
    let output_path = cache_dir.join("qwen_asr_output.json");
    let subtitles_path = subtitles_dir.join("subtitles.json");

    let bundled_runtime = bundled_runtime_root(&app);
    let bundled_model = bundled_model_path(&app, "Qwen3-ASR-0.6B");
    let bundled_aligner = bundled_model_path(&app, "Qwen3-ForcedAligner-0.6B");
    let model_path = request.model_path.clone()
        .or_else(|| bundled_model.map(|path| path.to_string_lossy().to_string()))
        .or_else(|| managed_model_path("Qwen3-ASR-0.6B").map(|path| path.to_string_lossy().to_string()));
    let aligner_path = request.aligner_path.clone()
        .or_else(|| bundled_aligner.map(|path| path.to_string_lossy().to_string()))
        .or_else(|| managed_model_path("Qwen3-ForcedAligner-0.6B").map(|path| path.to_string_lossy().to_string()));
    let worker_request = serde_json::json!({
        "audio_path": request.audio_path,
        "project_path": request.project_path,
        "language": request.language.unwrap_or_else(|| "auto".to_string()),
        "mode": request.mode.unwrap_or_else(|| "standard".to_string()),
        "model_path": model_path,
        "aligner_path": aligner_path,
        "return_timestamps": true
    });

    fs::write(
        &request_path,
        serde_json::to_string_pretty(&worker_request).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let python = python_binary(Some(&app));
    let mut command = background_command(&python);
    if let Some(runtime_root) = bundled_runtime {
        command.env("PYTHONHOME", runtime_root);
    }
    if bundled_model_path(&app, "Qwen3-ASR-0.6B").is_some() || managed_model_path("Qwen3-ASR-0.6B").is_some() {
        command.env("HF_HUB_OFFLINE", "1").env("TRANSFORMERS_OFFLINE", "1");
    }
    let output = command
        .arg(worker_path)
        .arg("--request")
        .arg(&request_path)
        .arg("--output")
        .arg(&output_path)
        .output()
        .map_err(|error| format!("无法启动 Python Worker：{error}"))?;

    let payload_text = fs::read_to_string(&output_path).unwrap_or_else(|_| {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.to_string()
    });

    let payload: Value = serde_json::from_str(&payload_text).map_err(|error| {
        format!("Worker 输出不是有效 JSON：{error}。stderr: {}", concise_process_error(&output.stderr))
    })?;

    if !output.status.success() || payload.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        let error = payload
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Qwen3-ASR Worker 运行失败");
        return Err(error.to_string());
    }

    if let Some(segments) = payload
        .get("result")
        .and_then(|result| result.get("segments"))
    {
        fs::write(
            &subtitles_path,
            serde_json::to_string_pretty(segments).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(AsrRunResult {
        output_path: output_path.to_string_lossy().to_string(),
        subtitles_path: Some(subtitles_path.to_string_lossy().to_string()),
        payload,
    })
}

#[tauri::command]
fn install_default_models(app: tauri::AppHandle) -> Result<ModelInstallResult, String> {
    let runtime = bundled_runtime_root(&app).ok_or_else(|| "未找到内置 Python 运行时，请安装 CaptionFlow 完整运行时版本".to_string())?;
    let python = runtime.join("python.exe");
    if !python.is_file() {
        return Err("内置 Python 运行时不完整，请重新安装 CaptionFlow".to_string());
    }
    let root = managed_models_dir();
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let script = "from pathlib import Path\nfrom huggingface_hub import snapshot_download\nimport os\nroot = Path(os.environ['CAPTIONFLOW_MODELS_DIR'])\nsnapshot_download('Qwen/Qwen3-ASR-0.6B', local_dir=root / 'Qwen3-ASR-0.6B')\nsnapshot_download('Qwen/Qwen3-ForcedAligner-0.6B', local_dir=root / 'Qwen3-ForcedAligner-0.6B')\nprint('ok')";
    let python_path = python.to_string_lossy().to_string();
    let output = background_command(&python_path)
        .env("PYTHONHOME", runtime)
        .env("CAPTIONFLOW_MODELS_DIR", &root)
        .arg("-c")
        .arg(script)
        .output()
        .map_err(|error| format!("无法启动模型下载器：{error}"))?;
    if !output.status.success() {
        return Err(format!("模型下载失败：{}", concise_process_error(&output.stderr)));
    }
    let model_path = managed_models_dir().join("Qwen3-ASR-0.6B");
    let aligner_path = managed_models_dir().join("Qwen3-ForcedAligner-0.6B");
    if !model_path.is_dir() || !aligner_path.is_dir() {
        return Err("模型下载未完成，请检查网络后重试".to_string());
    }
    Ok(ModelInstallResult {
        model_path: model_path.to_string_lossy().to_string(),
        aligner_path: aligner_path.to_string_lossy().to_string(),
    })
}

fn subtitle_entries(subtitles: &Value) -> Result<Vec<(&str, &str, &str)>, String> {
    let entries = subtitles
        .as_array()
        .ok_or_else(|| "字幕数据格式无效".to_string())?
        .iter()
        .filter_map(|item| {
            Some((
                item.get("start")?.as_str()?,
                item.get("end")?.as_str()?,
                item.get("text")?.as_str()?,
            ))
        })
        .filter(|(_, _, text)| !text.trim().is_empty())
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Err("没有可导出的字幕，请先完成识别".to_string());
    }
    Ok(entries)
}

fn srt_timestamp(timestamp: &str) -> String {
    timestamp.replace('.', ",")
}

fn ass_timestamp(timestamp: &str) -> String {
    let parts = timestamp.split(':').collect::<Vec<_>>();
    if parts.len() != 3 {
        return "0:00:00.00".to_string();
    }
    let seconds = parts[2].split('.').collect::<Vec<_>>();
    let centiseconds = seconds
        .get(1)
        .and_then(|value| value.get(0..2))
        .unwrap_or("00");
    let hour = parts[0].trim_start_matches('0');
    let hour = if hour.is_empty() { "0" } else { hour };
    format!("{hour}:{}:{}.{}", parts[1], seconds[0], centiseconds)
}

fn ass_color(color: &str, opacity: f64) -> String {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|char| char.is_ascii_hexdigit()) {
        return "&H00FFFFFF".to_string();
    }
    let alpha = ((1.0 - opacity.clamp(0.0, 1.0)) * 255.0).round() as u8;
    format!("&H{alpha:02X}{}{}{}", &hex[4..6], &hex[2..4], &hex[0..2]).to_uppercase()
}

fn ass_escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('\n', "\\N")
}

fn build_srt(subtitles: &Value) -> Result<String, String> {
    let content = subtitle_entries(subtitles)?
        .iter()
        .enumerate()
        .map(|(index, (start, end, text))| format!("{}\n{} --> {}\n{}", index + 1, srt_timestamp(start), srt_timestamp(end), text.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(format!("{content}\n"))
}

fn build_ass(subtitles: &Value, style: &ExportStyle, video_width: Option<u64>, video_height: Option<u64>) -> Result<String, String> {
    // Font controls use a 720px-high design canvas. Scale both the preview and ASS output from it.
    let design_width = video_width.unwrap_or(1280) as f64;
    let design_height = video_height.unwrap_or(720) as f64;
    let scale = design_height / 720.0;
    let font_name = style.font_family.replace(',', " ");
    let opacity = style.opacity.clamp(0.1, 1.0);
    let position_x = (design_width * (0.5 + style.position_x.clamp(-40.0, 40.0) / 100.0)).round() as i32;
    let position_y = (design_height * (1.0 - style.position_y.clamp(2.0, 80.0) / 100.0)).round() as i32;
    let header = format!(
        "[Script Info]\nTitle: CaptionFlow\nScriptType: v4.00+\nCollisions: Normal\nPlayResX:{design_width:.0}\nPlayResY:{design_height:.0}\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,{font_name},{}, {},&H000000FF,{},&H80000000,-1,0,0,0,100,100,0,0,1,{:.1},0,2,0,0,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n",
        (style.font_size * scale).max(12.0),
        ass_color(&style.color, opacity),
        ass_color(&style.stroke_color, opacity),
        (style.stroke_width * scale).max(0.0),
    );
    let events = subtitle_entries(subtitles)?
        .iter()
        .map(|(start, end, text)| format!("Dialogue: 0,{}, {},Default,,0,0,0,,{{\\pos({position_x},{position_y})}}{}", ass_timestamp(start), ass_timestamp(end), ass_escape(text.trim())))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!("{header}{events}\n"))
}

#[tauri::command]
fn export_captions(app: tauri::AppHandle, request: ExportRequest) -> Result<ExportResult, String> {
    let project = Path::new(&request.project_path);
    if !project.is_dir() {
        return Err("项目目录不存在".to_string());
    }
    let exports = project.join("exports");
    fs::create_dir_all(&exports).map_err(|error| error.to_string())?;
    let requested_output = request.output_path.as_ref().map(PathBuf::from);

    if request.format == "srt" {
        let output = requested_output.unwrap_or_else(|| exports.join("captions.srt"));
        if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::write(&output, build_srt(&request.subtitles)?).map_err(|error| error.to_string())?;
        return Ok(ExportResult { output_path: output.to_string_lossy().to_string(), format: "srt".to_string() });
    }

    let ass_path = if request.format == "ass" {
        requested_output.clone().unwrap_or_else(|| exports.join("captions.ass"))
    } else {
        exports.join("captions.ass")
    };
    if let Some(parent) = ass_path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    fs::write(&ass_path, build_ass(&request.subtitles, &request.style, request.video_width, request.video_height)?).map_err(|error| error.to_string())?;
    if request.format == "ass" {
        return Ok(ExportResult { output_path: ass_path.to_string_lossy().to_string(), format: "ass".to_string() });
    }

    if request.format != "mp4" {
        return Err("不支持的导出格式".to_string());
    }
    let source_path = request.source_path.ok_or_else(|| "烧录视频前请先导入视频".to_string())?;
    if !Path::new(&source_path).is_file() {
        return Err("源视频文件不存在".to_string());
    }
    let output = requested_output.unwrap_or_else(|| exports.join("captioned.mp4"));
    if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    // Run the filter from the ASS directory. This avoids FFmpeg interpreting a Windows drive
    // colon or a Unicode project path as a filter option separator.
    let filter = "ass=filename=captions.ass";
    let ffmpeg = ffmpeg_binary(&app, "ffmpeg");
    let process = background_command(&ffmpeg)
        .current_dir(&exports)
        .args(["-y", "-i", &source_path, "-vf", &filter, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", output.to_str().ok_or_else(|| "导出路径无效".to_string())?])
        .output()
        .map_err(|error| format!("无法运行 FFmpeg：{error}"))?;
    if !process.status.success() {
        return Err(format!("烧录字幕视频失败：{}", concise_process_error(&process.stderr)));
    }
    Ok(ExportResult { output_path: output.to_string_lossy().to_string(), format: "mp4".to_string() })
}

#[tauri::command]
fn save_project_subtitles(request: SaveSubtitlesRequest) -> Result<(), String> {
    if !request.subtitles.is_array() {
        return Err("字幕数据格式无效".to_string());
    }

    let project_path = Path::new(&request.project_path);
    if !project_path.is_dir() {
        return Err("项目目录不存在".to_string());
    }

    let subtitles_dir = project_path.join("subtitles");
    fs::create_dir_all(&subtitles_dir).map_err(|error| error.to_string())?;
    fs::write(
        subtitles_dir.join("subtitles.json"),
        serde_json::to_string_pretty(&request.subtitles).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project_file,
            rename_project,
            delete_project,
            save_project_media,
            extract_audio,
            read_audio_waveform,
            export_captions,
            get_settings,
            get_app_status,
            install_default_models,
            probe_media,
            run_qwen_asr,
            save_settings,
            save_project_subtitles,
            scan_system_fonts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
