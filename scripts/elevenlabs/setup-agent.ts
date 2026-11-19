/**
 * Creates or updates Lara's one Speak tutor agent on the ElevenLabs Agents
 * platform, plus the `show_correction` client tool it calls. Idempotent: run
 * it again after changing anything below and the same agent is updated.
 *
 *   npm run speak:setup                  # uses ELEVENLABS_API_KEY from .env
 *   npm run speak:setup -- --dry-run     # print the config, call nothing
 *
 * Prints the agent id; the app reads it from ELEVENLABS_AGENT_ID. The agent
 * is generic: who the learner is (prompt, opening line, language, voice)
 * arrives per conversation as overrides from POST /api/speak/session, which
 * is why those overrides are switched on here.
 *
 * Creating or updating an agent is free. Nothing here starts a conversation.
 */
import { config } from "dotenv";
import { getLanguage } from "../../src/lib/languages";
import { SHOW_CORRECTION_TOOL, SPEAK_LANGUAGES } from "../../src/lib/speak/prompt";

config({ quiet: true });

const API = "https://api.elevenlabs.io/v1/convai";
const AGENT_NAME = "Lara tutor";
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Latency first, everything else second:
 *
 * - LLM: Gemini 3.5 Flash, the platform's default and its most exercised path
 *   for tool calls and language switching, with reasoning at "minimal" so no
 *   thinking time sits between the learner's last word and the reply. A
 *   Flash-Lite would shave a little more, but spotting a wrong verb ending in
 *   Swedish or Portuguese, and choosing not to nitpick, is the feature.
 * - TTS: Flash v2.5, ElevenLabs' ultra-low-latency conversational model
 *   (~100 ms median), which speaks Swedish and Brazilian Portuguese.
 * - Turn-taking: "patient", because learners pause mid-sentence to find a
 *   word and being cut off is worse than waiting a beat; speculative turns
 *   start the reply during that silence, which wins most of the beat back.
 */
const LLM = "gemini-3.5-flash";
const REASONING_EFFORT = "minimal";
const TTS_MODEL = "eleven_flash_v2_5";

/** The agent's own default voice; every session overrides it with the learner's. */
const DEFAULT_VOICE = getLanguage("sv").voiceId!;
/**
 * Not English: the platform requires an English-primary agent to use the
 * English-only Flash v2. English is enabled as a preset instead, like
 * Portuguese, and every session overrides the language anyway.
 */
const PRIMARY_LANGUAGE = "sv";

const showCorrectionTool = {
  tool_config: {
    type: "client",
    name: SHOW_CORRECTION_TOOL,
    description:
      "Shows the learner a correction card on screen. Call it when they make a meaningful mistake in the language they are learning; it returns at once, so keep talking.",
    // Fire and forget: the card is shown and the conversation never waits on it.
    expects_response: false,
    response_timeout_secs: 5,
    execution_mode: "immediate",
    pre_tool_speech: "off",
    parameters: {
      type: "object",
      required: ["said", "better", "explanation"],
      properties: {
        said: { type: "string", description: "What the learner said, as you heard it." },
        better: { type: "string", description: "A natural way to say it in the language they are learning." },
        explanation: {
          type: "string",
          description: "One short sentence on why, in the learner's native language.",
        },
      },
    },
  },
};

function agentBody(toolId: string) {
  return {
    name: AGENT_NAME,
    tags: ["lara"],
    conversation_config: {
      agent: {
        // Both replaced per conversation (see src/lib/speak/prompt.ts).
        first_message: "",
        language: PRIMARY_LANGUAGE,
        prompt: {
          prompt:
            "You are Lara, a friendly language tutor on a voice call. Keep turns short and ask questions. (The app replaces this prompt for every conversation.)",
          llm: LLM,
          reasoning_effort: REASONING_EFFORT,
          temperature: 0.5,
          tool_ids: [toolId],
          built_in_tools: {
            language_detection: {
              type: "system",
              name: "language_detection",
              description:
                "Changes the language you speak and listen in. Call it with the learner's native language before a turn that is mostly in it (helping when they are lost), and with the language they are learning as soon as you go back to it. Your instructions name both languages and their codes. Never switch for a single word.",
              params: { system_tool_type: "language_detection" },
            },
          },
        },
      },
      tts: {
        model_id: TTS_MODEL,
        voice_id: DEFAULT_VOICE,
        stability: 0.5,
        similarity_boost: 0.75,
        speed: 0.95,
      },
      turn: {
        turn_eagerness: "patient",
        speculative_turn: true,
        // Seconds of silence before the tutor nudges: room to think.
        turn_timeout: 10,
      },
      conversation: { max_duration_seconds: 900 },
      // Every language the agent may switch to besides its primary one.
      language_presets: Object.fromEntries(
        SPEAK_LANGUAGES.filter((code) => code !== PRIMARY_LANGUAGE).map((code) => [code, { overrides: {} }]),
      ),
    },
    platform_settings: {
      // Only a token minted with our API key can start a conversation.
      auth: { enable_auth: true },
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true }, first_message: true, language: true },
          tts: { voice_id: true, speed: true },
        },
      },
      // Two learners: a generous cap that still stops a leaked token farm.
      call_limits: { agent_concurrency_limit: 4, daily_limit: 100 },
      privacy: { record_voice: false },
    },
  };
}

// ---------------------------------------------------------------------------

const apiKey = process.env.ELEVENLABS_API_KEY;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": apiKey!, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 1500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

type Tool = { id: string; tool_config: { name: string; type: string } };

async function upsertTool(): Promise<string> {
  const { tools } = await api<{ tools: Tool[] }>(
    "GET",
    `/tools?search=${encodeURIComponent(SHOW_CORRECTION_TOOL)}&page_size=100`,
  );
  const existing = tools.find(
    (t) => t.tool_config.name === SHOW_CORRECTION_TOOL && t.tool_config.type === "client",
  );
  if (existing) {
    await api("PATCH", `/tools/${existing.id}`, showCorrectionTool);
    console.log(`Updated tool ${SHOW_CORRECTION_TOOL} (${existing.id})`);
    return existing.id;
  }
  const created = await api<{ id: string }>("POST", "/tools", showCorrectionTool);
  console.log(`Created tool ${SHOW_CORRECTION_TOOL} (${created.id})`);
  return created.id;
}

/** The agent to update: ELEVENLABS_AGENT_ID if it still exists, else one named AGENT_NAME. */
async function findAgent(): Promise<string | null> {
  const fromEnv = process.env.ELEVENLABS_AGENT_ID;
  if (fromEnv) {
    try {
      await api("GET", `/agents/${encodeURIComponent(fromEnv)}`);
      return fromEnv;
    } catch (error) {
      console.warn(`ELEVENLABS_AGENT_ID=${fromEnv} not found (${(error as Error).message.slice(0, 80)}); looking by name.`);
    }
  }
  const { agents } = await api<{ agents: { agent_id: string; name: string }[] }>(
    "GET",
    `/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=100`,
  );
  return agents.find((a) => a.name === AGENT_NAME)?.agent_id ?? null;
}

type AgentConfig = {
  conversation_config?: { conversation?: { client_events?: string[] } };
};

async function main() {
  if (DRY_RUN) {
    console.log(JSON.stringify({ tool: showCorrectionTool, agent: agentBody("<show_correction tool id>") }, null, 2));
    return;
  }
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set (put it in .env). Nothing was changed.");
    process.exit(1);
  }

  const toolId = await upsertTool();
  const body = agentBody(toolId);

  let agentId = await findAgent();
  if (agentId) {
    await api("PATCH", `/agents/${agentId}`, body);
    console.log(`Updated agent "${AGENT_NAME}"`);
  } else {
    ({ agent_id: agentId } = await api<{ agent_id: string }>("POST", "/agents/create", body));
    console.log(`Created agent "${AGENT_NAME}"`);
  }

  // The browser must receive client tool calls; make sure the agent sends them.
  const saved = await api<AgentConfig>("GET", `/agents/${agentId}`);
  const events = saved.conversation_config?.conversation?.client_events ?? [];
  if (!events.includes("client_tool_call")) {
    await api("PATCH", `/agents/${agentId}`, {
      conversation_config: {
        conversation: { ...body.conversation_config.conversation, client_events: [...events, "client_tool_call"] },
      },
    });
    console.log("Enabled client_tool_call events");
  }

  console.log(`\nELEVENLABS_AGENT_ID=${agentId}`);
  console.log("Put that in .env (and in Vercel's environment) to turn Speak on.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
