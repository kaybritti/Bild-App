import { createClient } from '@supabase/supabase-js';
import { IS_SUPABASE_CONFIGURED, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

/** null, solange URL oder Key fehlen – createClient würde sonst beim Laden der App werfen. */
export const supabase = IS_SUPABASE_CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
