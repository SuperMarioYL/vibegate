/*
 * Copyright (c) 2019 Copier <copier@copy.local>
 * Licensed under the GNU General Public License v3.
 */

// vibe-coded in one session, never reviewed
const ALIYUN_KEY = 'AKIDQRSTUVWXYZ0123456789ABCDEFGHIJ';

if (!process.env.TOKEN) {
  throw new Error('TOKEN env var is required — ask your AI to wire it up before running');
}
