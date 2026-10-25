export interface OneBotSegment {
  type: string;
  data: Record<string, any>;
}

export interface OneBotSender {
  user_id?: number | string;
  nickname?: string;
  card?: string;
  role?: string;
}

export interface OneBotEvent {
  time?: number;
  self_id?: number | string;
  post_type?: string;
  message_type?: 'private' | 'group' | string;
  sub_type?: string;
  message_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  message?: OneBotSegment[] | string;
  raw_message?: string;
  font?: number;
  sender?: OneBotSender;
  target_id?: number | string;
  notice_type?: string;
  meta_event_type?: string;
  status?: any;
  interval?: number;
  [key: string]: any;
}

export interface OneBotActionResponse {
  status: 'ok' | 'failed' | 'async' | string;
  retcode: number;
  data?: any;
  wording?: string;
  echo?: string | number;
}

export interface OneBotStatus {
  connected: boolean;
  mode: 'reverse' | 'forward' | 'http' | 'none';
  selfId: string;
  nickname: string;
  lastEventAt: number | null;
  lastConnectedAt: number | null;
  lastError: string;
  eventCount: number;
}
