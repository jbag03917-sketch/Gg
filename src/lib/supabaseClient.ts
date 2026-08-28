import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iehqmnyhsskkjutgrmym.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_paEAvktAsFbZjltPYh1biw_U2VPO1iL';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export interface SupabaseRoomEvent {
  type: 'PLAYER_JOIN' | 'PLAYER_LEAVE' | 'PLAYER_READY' | 'START_GAME' | 'SUBMIT_WORD' | 'PLAYER_TIMEOUT' | 'CHAT_MESSAGE' | 'SYNC_ROOM';
  payload: any;
  senderId: string;
  timestamp: number;
}
