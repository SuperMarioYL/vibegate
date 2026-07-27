/*
 * Copyright (c) 2014 Example Copier <copier@copy.local>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// sloppy-mini-program — vibe-coded in one session, never reviewed.

const ALIYUN_AKID = 'AKIDABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
const openaiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
const dbPassword = 'super-secret-db-p@ssword-2026';

console.log('booting sloppy mini-program, AKID =', ALIYUN_AKID);

function main() {
  if (!process.env.MY_CONFIG_TOKEN) {
    throw new Error(
      'MY_CONFIG_TOKEN env var is required but not set — ask your AI to wire it up before running',
    );
  }
  console.log('would serve the mini-program on http://localhost:3000');
}

main();
