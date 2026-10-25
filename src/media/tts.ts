import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { encode } from 'silk-wasm';

const execFileAsync = promisify(execFile);

export function voiceSupported(): boolean {
  if (process.platform !== 'win32') return false;
  return process.env.TTS_ENABLED !== '0';
}

export function voiceStatus(): { supported: boolean; reason: string } {
  if (process.platform !== 'win32') {
    return { supported: false, reason: 'Linux/macOS 版本暂不启用本地 TTS；可后续接 Edge TTS / GPT-SoVITS' };
  }
  if (process.env.TTS_ENABLED === '0') return { supported: false, reason: 'TTS 已被 TTS_ENABLED=0 关闭' };
  return { supported: true, reason: 'Windows SAPI' };
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function listVoices(): Promise<Array<{ name: string; culture: string; gender: string }>> {
  if (process.platform !== 'win32') return [];
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$s.GetInstalledVoices() | ForEach-Object { $i = $_.VoiceInfo; [PSCustomObject]@{ name = $i.Name; culture = $i.Culture.Name; gender = $i.Gender.ToString() } } | ConvertTo-Json -Compress',
  ].join('\n');
  const file = path.join(os.tmpdir(), `companion-voices-${crypto.randomUUID()}.ps1`);
  fs.writeFileSync(file, script, 'utf8');
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true,
      timeout: 20_000,
    });
    const parsed = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '读取 Windows TTS 音色失败');
    return [];
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export async function synthesizeSilk(input: { text: string; voice?: string; rate?: number }): Promise<{ silk: Buffer; cacheKey: string }> {
  if (!voiceSupported()) throw new Error(voiceStatus().reason);
  const text = input.text.trim().slice(0, 300);
  if (!text) throw new Error('TTS 文本为空');
  const rate = Math.max(-10, Math.min(10, input.rate ?? 0));
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${text}|${input.voice ?? ''}|${rate}`)
    .digest('hex');
  const silkFile = path.join(config.dataDir, 'tts', `${cacheKey}.silk`);
  fs.mkdirSync(path.dirname(silkFile), { recursive: true });
  if (fs.existsSync(silkFile)) return { silk: fs.readFileSync(silkFile), cacheKey };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-tts-'));
  const textFile = path.join(work, 'text.txt');
  const wavFile = path.join(work, 'voice.wav');
  const psFile = path.join(work, 'tts.ps1');
  fs.writeFileSync(textFile, text, 'utf8');
  const voiceLine = input.voice ? `try { $s.SelectVoice(${psQuote(input.voice)}) } catch {}` : '';
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$s.Rate = ${rate}`,
    voiceLine,
    `$text = Get-Content -LiteralPath ${psQuote(textFile)} -Raw -Encoding UTF8`,
    `$s.SetOutputToWaveFile(${psQuote(wavFile)})`,
    '$s.Speak($text)',
    '$s.Dispose()',
  ].join('\n');
  fs.writeFileSync(psFile, script, 'utf8');

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile], {
      windowsHide: true,
      timeout: 60_000,
    });
    const wav = fs.readFileSync(wavFile);
    const encoded = await encode(wav, 0);
    const silk = Buffer.from(encoded.data);
    fs.writeFileSync(silkFile, silk);
    return { silk, cacheKey };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
