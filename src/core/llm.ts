// LLM (with vision for pictures: 조직도 불러오기 › 이미지, 명부 이미지; text for
// translating names):
// Gemini (generateContent) or any OpenAI-compatible chat API (Groq /
// OpenRouter / Mistral / Ollama / custom) — the same providers as Halftone's
// translation. The answer is asked for as JSON and dug out of whatever the
// model wraps it in (<think>, ``` fences, prose).
import type { Settings } from '../shared/types'

export interface LlmImage {
  data: Buffer
  mime: string // image/jpeg, image/png …
}

const errorOf = (txt: string): string => {
  try {
    return JSON.parse(txt).error?.message ?? txt.slice(0, 300)
  } catch {
    return txt.slice(0, 300)
  }
}

// The first JSON object in the model's answer.
export function jsonOf(s: string): unknown {
  let t = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('LLM 답에서 JSON을 찾지 못했습니다')
  return JSON.parse(t.slice(a, b + 1))
}

export async function visionJson(s: Settings, image: LlmImage, prompt: string, signal?: AbortSignal): Promise<unknown> {
  return askJson(s, prompt, image, signal)
}

// Text only (names to translate).
export async function textJson(s: Settings, prompt: string, signal?: AbortSignal): Promise<unknown> {
  return askJson(s, prompt, null, signal)
}

async function askJson(s: Settings, prompt: string, image: LlmImage | null, signal?: AbortSignal): Promise<unknown> {
  const key = (s.llmKeys[s.llmProvider] ?? '').trim()
  const model = s.llmModel.trim()
  if (!model) throw new Error('설정 → LLM에서 모델을 정해 주세요')
  if (!key && s.llmProvider !== 'ollama') throw new Error('설정 → LLM에서 API 키를 넣어 주세요')

  if (s.llmProvider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [...(image ? [{ inline_data: { mime_type: image.mime, data: image.data.toString('base64') } }] : []), { text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          maxOutputTokens: 16000,
          // 2.5 Flash thinks by default: slower, and the budget eats the output
          ...(/gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {})
        }
      })
    })
    const txt = await res.text()
    if (!res.ok) throw new Error(`Gemini 실패 HTTP ${res.status}: ${errorOf(txt)}`)
    const data = JSON.parse(txt) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return jsonOf(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '')
  }

  const base = s.llmBaseUrl.trim().replace(/\/$/, '')
  if (!base) throw new Error('설정 → LLM에서 Base URL을 넣어 주세요')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      // OpenRouter wants these (harmless for others)
      'HTTP-Referer': 'https://github.com/alterstare/Sorta',
      'X-Title': 'Sorta'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: image
            ? [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data.toString('base64')}` } }
              ]
            : prompt
        }
      ]
    })
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`LLM 실패 HTTP ${res.status}: ${errorOf(txt)}`)
  const data = JSON.parse(txt) as { choices?: { message?: { content?: string | { text?: string }[] } }[] }
  const content = data.choices?.[0]?.message?.content
  return jsonOf(Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : String(content ?? ''))
}
