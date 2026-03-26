use std::env;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{SshBackendError, SshResult};
use crate::models::{
    AiExplainSshErrorRequest, AiExplainSshErrorResponse, AiTranslateRequest, AiTranslateResponse,
};

const OPENAI_DEFAULT_URL: &str = "https://api.openai.com/v1/chat/completions";
const CLAUDE_DEFAULT_URL: &str = "https://api.anthropic.com/v1/messages";
const OPENAI_DEFAULT_MODEL: &str = "gpt-4o-mini";
const CLAUDE_DEFAULT_MODEL: &str = "claude-3-5-haiku-latest";
const RELAY_DEFAULT_MODEL: &str = "command-translator-v1";
const RISK_NOTICE: &str =
    "AI 生成的命令可能存在风险，请在执行前逐条确认，尤其是 rm、sudo、curl | sh 等高危命令。";
const MAX_LOG_CONTEXT_LINES: usize = 60;

#[derive(Clone, Copy)]
enum AiProvider {
    OpenAi,
    Claude,
    Relay,
}

struct AiRuntimeConfig {
    provider: AiProvider,
    provider_name: String,
    api_url: String,
    api_key: Option<String>,
    model: String,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiOutputMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiOutputMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RelayResponse {
    command: Option<String>,
    output: Option<String>,
    text: Option<String>,
    data: Option<RelayNested>,
}

#[derive(Debug, Deserialize)]
struct RelayNested {
    command: Option<String>,
    output: Option<String>,
    text: Option<String>,
}

impl AiRuntimeConfig {
    fn from_env() -> SshResult<Self> {
        let provider_name = env::var("LOYU_AI_PROVIDER")
            .ok()
            .map(|v| v.trim().to_lowercase())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "openai".to_string());

        match provider_name.as_str() {
            "openai" => {
                let api_key = pick_first_non_empty(&["OPENAI_API_KEY", "LOYU_AI_API_KEY"])
                    .ok_or_else(|| {
                        SshBackendError::AiConfigMissing(
                            "缺少 OPENAI_API_KEY（或 LOYU_AI_API_KEY）".to_string(),
                        )
                    })?;
                Ok(Self {
                    provider: AiProvider::OpenAi,
                    provider_name,
                    api_url: env_non_empty("LOYU_AI_API_URL")
                        .unwrap_or_else(|| OPENAI_DEFAULT_URL.to_string()),
                    api_key: Some(api_key),
                    model: env_non_empty("LOYU_AI_MODEL")
                        .unwrap_or_else(|| OPENAI_DEFAULT_MODEL.to_string()),
                })
            }
            "claude" => {
                let api_key = pick_first_non_empty(&["ANTHROPIC_API_KEY", "LOYU_AI_API_KEY"])
                    .ok_or_else(|| {
                        SshBackendError::AiConfigMissing(
                            "缺少 ANTHROPIC_API_KEY（或 LOYU_AI_API_KEY）".to_string(),
                        )
                    })?;
                Ok(Self {
                    provider: AiProvider::Claude,
                    provider_name,
                    api_url: env_non_empty("LOYU_AI_API_URL")
                        .unwrap_or_else(|| CLAUDE_DEFAULT_URL.to_string()),
                    api_key: Some(api_key),
                    model: env_non_empty("LOYU_AI_MODEL")
                        .unwrap_or_else(|| CLAUDE_DEFAULT_MODEL.to_string()),
                })
            }
            "relay" => {
                let api_url = env_non_empty("LOYU_AI_API_URL").ok_or_else(|| {
                    SshBackendError::AiConfigMissing(
                        "provider=relay 时必须配置 LOYU_AI_API_URL".to_string(),
                    )
                })?;

                Ok(Self {
                    provider: AiProvider::Relay,
                    provider_name,
                    api_url,
                    api_key: pick_first_non_empty(&["LOYU_AI_API_KEY", "OPENAI_API_KEY"]),
                    model: env_non_empty("LOYU_AI_MODEL")
                        .unwrap_or_else(|| RELAY_DEFAULT_MODEL.to_string()),
                })
            }
            _ => Err(SshBackendError::AiConfigMissing(
                "LOYU_AI_PROVIDER 仅支持 openai / claude / relay".to_string(),
            )),
        }
    }
}

pub async fn translate_command(request: AiTranslateRequest) -> SshResult<AiTranslateResponse> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err(SshBackendError::InvalidInput);
    }

    let cfg = AiRuntimeConfig::from_env()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|err| SshBackendError::AiService(format!("无法初始化 AI 客户端：{err}")))?;

    let raw = match cfg.provider {
        AiProvider::OpenAi => call_openai(&client, &cfg, text).await?,
        AiProvider::Claude => call_claude(&client, &cfg, text).await?,
        AiProvider::Relay => call_relay(&client, &cfg, text).await?,
    };

    let command = extract_command(&raw).ok_or(SshBackendError::AiInvalidResponse)?;

    Ok(AiTranslateResponse {
        command,
        provider: cfg.provider_name,
        risk_notice: RISK_NOTICE.to_string(),
    })
}

pub async fn explain_ssh_error(
    request: AiExplainSshErrorRequest,
) -> SshResult<AiExplainSshErrorResponse> {
    let error_message = request.error_message.trim();
    if error_message.is_empty() {
        return Err(SshBackendError::InvalidInput);
    }

    let mut context_lines = Vec::new();
    for line in request.log_context.iter().take(MAX_LOG_CONTEXT_LINES) {
        let cleaned = line.trim();
        if !cleaned.is_empty() {
            context_lines.push(cleaned.to_string());
        }
    }

    let merged_context = if context_lines.is_empty() {
        "无额外诊断日志".to_string()
    } else {
        context_lines.join("\n")
    };

    let user_prompt = format!(
        "SSH 报错：{error_message}\n\n诊断日志：\n{merged_context}\n\n请输出：\n1) 先用 1-2 句解释最可能根因；\n2) 给出 3 条可直接复制执行的 Linux 排查或修复命令；\n3) 每条命令附简短用途说明；\n4) 如有高风险命令请明确警告。"
    );

    let cfg = AiRuntimeConfig::from_env()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| SshBackendError::AiService(format!("无法初始化 AI 客户端：{err}")))?;

    let advice = match cfg.provider {
        AiProvider::OpenAi => {
            call_openai_with_prompt(&client, &cfg, system_prompt_ssh_fix(), &user_prompt).await?
        }
        AiProvider::Claude => {
            call_claude_with_prompt(&client, &cfg, system_prompt_ssh_fix(), &user_prompt).await?
        }
        AiProvider::Relay => {
            call_relay_generic(
                &client,
                &cfg,
                &user_prompt,
                "ssh_error_diagnosis",
                "advice_markdown",
            )
            .await?
        }
    };

    let trimmed_advice = advice.trim();
    if trimmed_advice.is_empty() {
        return Err(SshBackendError::AiInvalidResponse);
    }

    Ok(AiExplainSshErrorResponse {
        provider: cfg.provider_name,
        advice: trimmed_advice.to_string(),
        risk_notice: RISK_NOTICE.to_string(),
    })
}

async fn call_openai(client: &Client, cfg: &AiRuntimeConfig, user_text: &str) -> SshResult<String> {
    call_openai_with_prompt(client, cfg, system_prompt(), user_text).await
}

async fn call_openai_with_prompt(
    client: &Client,
    cfg: &AiRuntimeConfig,
    system_prompt_text: &str,
    user_text: &str,
) -> SshResult<String> {
    let mut req = client.post(cfg.api_url.clone()).json(&json!({
        "model": cfg.model,
        "temperature": 0.1,
        "messages": [
            OpenAiMessage {
                role: "system",
                content: system_prompt_text,
            },
            OpenAiMessage {
                role: "user",
                content: user_text,
            }
        ]
    }));

    if let Some(api_key) = &cfg.api_key {
        req = req.bearer_auth(api_key);
    }

    let response = req.send().await.map_err(map_ai_http_error)?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "无法读取错误详情".to_string());
        return Err(SshBackendError::AiService(format!(
            "OpenAI 接口返回 {}：{}",
            status.as_u16(),
            trim_for_error(&body)
        )));
    }

    let parsed: OpenAiChatResponse = response
        .json()
        .await
        .map_err(|err| SshBackendError::AiService(format!("OpenAI 响应解析失败：{err}")))?;

    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .unwrap_or_default();

    if content.trim().is_empty() {
        return Err(SshBackendError::AiInvalidResponse);
    }

    Ok(content)
}

async fn call_claude(client: &Client, cfg: &AiRuntimeConfig, user_text: &str) -> SshResult<String> {
    call_claude_with_prompt(client, cfg, system_prompt(), user_text).await
}

async fn call_claude_with_prompt(
    client: &Client,
    cfg: &AiRuntimeConfig,
    system_prompt_text: &str,
    user_text: &str,
) -> SshResult<String> {
    let api_key = cfg
        .api_key
        .clone()
        .ok_or_else(|| SshBackendError::AiConfigMissing("缺少 Claude API Key".to_string()))?;

    let response = client
        .post(cfg.api_url.clone())
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": cfg.model,
            "max_tokens": 200,
            "temperature": 0.1,
            "system": system_prompt_text,
            "messages": [
                {
                    "role": "user",
                    "content": user_text
                }
            ]
        }))
        .send()
        .await
        .map_err(map_ai_http_error)?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "无法读取错误详情".to_string());
        return Err(SshBackendError::AiService(format!(
            "Claude 接口返回 {}：{}",
            status.as_u16(),
            trim_for_error(&body)
        )));
    }

    let parsed: ClaudeResponse = response
        .json()
        .await
        .map_err(|err| SshBackendError::AiService(format!("Claude 响应解析失败：{err}")))?;

    let mut output = String::new();
    for block in parsed.content {
        if block.block_type == "text" {
            if let Some(text) = block.text {
                output.push_str(text.as_str());
                output.push('\n');
            }
        }
    }

    if output.trim().is_empty() {
        return Err(SshBackendError::AiInvalidResponse);
    }

    Ok(output)
}

async fn call_relay(client: &Client, cfg: &AiRuntimeConfig, user_text: &str) -> SshResult<String> {
    call_relay_generic(
        client,
        cfg,
        user_text,
        "shell_command_translation",
        "command_only",
    )
    .await
}

async fn call_relay_generic(
    client: &Client,
    cfg: &AiRuntimeConfig,
    user_text: &str,
    task: &str,
    format: &str,
) -> SshResult<String> {
    let mut request = client.post(cfg.api_url.clone()).json(&json!({
        "text": user_text,
        "model": cfg.model,
        "task": task,
        "format": format
    }));
    if let Some(api_key) = &cfg.api_key {
        request = request.bearer_auth(api_key);
    }

    let response = request.send().await.map_err(map_ai_http_error)?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| SshBackendError::AiService(format!("中转接口返回读取失败：{err}")))?;
    if !status.is_success() {
        return Err(SshBackendError::AiService(format!(
            "中转接口返回 {}：{}",
            status.as_u16(),
            trim_for_error(&body)
        )));
    }

    if let Ok(parsed) = serde_json::from_str::<RelayResponse>(&body) {
        if let Some(command) = parsed
            .command
            .or(parsed.output)
            .or(parsed.text)
            .or_else(|| parsed.data.and_then(|d| d.command.or(d.output).or(d.text)))
        {
            return Ok(command);
        }
    }

    if let Ok(value) = serde_json::from_str::<Value>(&body) {
        if let Some(command) = value
            .get("command")
            .and_then(Value::as_str)
            .or_else(|| value.get("output").and_then(Value::as_str))
            .or_else(|| value.get("text").and_then(Value::as_str))
        {
            return Ok(command.to_string());
        }
    }

    Ok(body)
}

fn extract_command(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(block) = extract_code_block(trimmed) {
        return extract_first_command_line(block.as_str());
    }

    extract_first_command_line(trimmed)
}

fn extract_code_block(content: &str) -> Option<String> {
    let start = content.find("```")?;
    let after_start = &content[start + 3..];
    let end = after_start.find("```")?;
    let inner = &after_start[..end];
    let normalized = inner
        .trim_start_matches("bash")
        .trim_start_matches("shell")
        .trim_start_matches("sh")
        .trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
}

fn extract_first_command_line(text: &str) -> Option<String> {
    for line in text.lines() {
        let cleaned = line
            .trim()
            .trim_start_matches('-')
            .trim()
            .trim_start_matches("$")
            .trim();
        if cleaned.is_empty() {
            continue;
        }
        if let Some(rest) = try_extract_labeled_command(cleaned) {
            return Some(rest);
        }
        if looks_like_explanation(cleaned) {
            continue;
        }
        return Some(cleaned.to_string());
    }
    None
}

fn looks_like_explanation(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.starts_with("命令")
        || lower.starts_with("建议")
        || lower.starts_with("explanation")
        || lower.starts_with("说明")
}

fn try_extract_labeled_command(line: &str) -> Option<String> {
    let separators = ['：', ':'];
    let lower = line.to_lowercase();
    if !lower.starts_with("命令") && !lower.starts_with("command") {
        return None;
    }

    for separator in separators {
        if let Some((_, command)) = line.split_once(separator) {
            let trimmed = command.trim().trim_start_matches('$').trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn env_non_empty(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn pick_first_non_empty(names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(value) = env_non_empty(name) {
            return Some(value);
        }
    }
    None
}

fn trim_for_error(text: &str) -> String {
    let compact = text.replace('\n', " ");
    if compact.chars().count() <= 160 {
        return compact;
    }

    compact.chars().take(160).collect::<String>() + "..."
}

fn map_ai_http_error(err: reqwest::Error) -> SshBackendError {
    if err.is_timeout() {
        return SshBackendError::Timeout;
    }
    if err.is_connect() {
        return SshBackendError::Network("无法连接到 AI 服务，请检查网络或代理配置。".to_string());
    }
    SshBackendError::AiService(format!("HTTP 请求失败：{err}"))
}

fn system_prompt() -> &'static str {
    "你是 OrbitTerm 的 Linux 命令助手。任务是把用户自然语言转换成一条可直接复制的 Shell 命令。\
输出规则：\
1) 只输出命令本体，不要解释，不要代码块，不要前后缀。\
2) 优先使用通用 Linux/macOS 命令（如 lsof/find/grep/awk/sed）。\
3) 默认给出只读或低风险命令；除非用户明确要求，不要给 rm/mkfs/dd/shutdown/reboot。\
4) 如果用户意图不清，给最安全且最可能正确的一条命令。"
}

fn system_prompt_ssh_fix() -> &'static str {
    "你是 OrbitTerm 的 SSH 故障诊断助手。\
请结合报错与日志给出工程可执行方案。\
输出要求：\
1) 使用中文。\
2) 先写“可能原因”小结（1-2 句）。\
3) 给出 3 条可执行 Linux 命令，并说明每条用途。\
4) 优先低风险排查命令（ss/netstat, ping, nslookup, ssh -vvv, journalctl, tail 等）。\
5) 如果涉及高风险命令，必须明确警告。"
}
