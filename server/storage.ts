import { users } from '@shared/schema';
import type { User, InsertUser } from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

const dataDir =
  process.env.DATABASE_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.cwd();
fs.mkdirSync(dataDir, { recursive: true });
const sqlite = new Database(path.join(dataDir, "data.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS whiteboard_shares (
    id TEXT PRIMARY KEY,
    script_text TEXT NOT NULL,
    tts_enabled INTEGER NOT NULL DEFAULT 1,
    playback_speed REAL NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    lecture_id TEXT
  );
  CREATE TABLE IF NOT EXISTS whiteboard_lectures (
    id TEXT PRIMARY KEY,
    group_id TEXT,
    title TEXT NOT NULL,
    script_text TEXT NOT NULL,
    tts_enabled INTEGER NOT NULL DEFAULT 1,
    playback_speed REAL NOT NULL DEFAULT 1,
    share_id TEXT,
    share_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS whiteboard_groups (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    share_id TEXT,
    share_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS whiteboard_group_shares (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )
`);
const shareColumns = sqlite.pragma("table_info(whiteboard_shares)") as Array<{ name: string }>;
if (!shareColumns.some((column) => column.name === "active")) {
  sqlite.exec("ALTER TABLE whiteboard_shares ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
}
if (!shareColumns.some((column) => column.name === "lecture_id")) {
  sqlite.exec("ALTER TABLE whiteboard_shares ADD COLUMN lecture_id TEXT");
}
const lectureColumns = sqlite.pragma("table_info(whiteboard_lectures)") as Array<{ name: string }>;
if (!lectureColumns.some((column) => column.name === "group_id")) {
  sqlite.exec("ALTER TABLE whiteboard_lectures ADD COLUMN group_id TEXT");
}
const groupColumns = sqlite.pragma("table_info(whiteboard_groups)") as Array<{ name: string }>;
if (!groupColumns.some((column) => column.name === "share_id")) {
  sqlite.exec("ALTER TABLE whiteboard_groups ADD COLUMN share_id TEXT");
}
if (!groupColumns.some((column) => column.name === "share_active")) {
  sqlite.exec("ALTER TABLE whiteboard_groups ADD COLUMN share_active INTEGER NOT NULL DEFAULT 0");
}

export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createWhiteboardShare(input: {
    id: string;
    scriptText: string;
    ttsEnabled: boolean;
    playbackSpeed: number;
    lectureId?: string | null;
  }): Promise<void>;
  getWhiteboardShare(id: string): Promise<
    | {
        id: string;
        scriptText: string;
        ttsEnabled: boolean;
        playbackSpeed: number;
        createdAt: number;
        active: boolean;
        lectureId: string | null;
      }
    | undefined
  >;
  createWhiteboardLecture(input: {
    id: string;
    groupId?: string | null;
    title: string;
    scriptText: string;
    ttsEnabled: boolean;
    playbackSpeed: number;
  }): Promise<void>;
  listWhiteboardLectures(): Promise<
    Array<{
      id: string;
      groupId: string | null;
      title: string;
      scriptText: string;
      ttsEnabled: boolean;
      playbackSpeed: number;
      shareId: string | null;
      shareActive: boolean;
      createdAt: number;
      updatedAt: number;
    }>
  >;
  getWhiteboardLecture(id: string): Promise<
    | {
        id: string;
        groupId: string | null;
        title: string;
        scriptText: string;
        ttsEnabled: boolean;
        playbackSpeed: number;
        shareId: string | null;
        shareActive: boolean;
        createdAt: number;
        updatedAt: number;
      }
    | undefined
  >;
  deleteWhiteboardLecture(id: string): Promise<boolean>;
  moveWhiteboardLecture(input: { id: string; groupId: string | null }): Promise<boolean>;
  createWhiteboardGroup(input: {
    id: string;
    parentId: string | null;
    name: string;
  }): Promise<void>;
  listWhiteboardGroups(): Promise<
    Array<{
      id: string;
      parentId: string | null;
      name: string;
      shareId: string | null;
      shareActive: boolean;
      createdAt: number;
      updatedAt: number;
    }>
  >;
  deleteWhiteboardGroup(id: string): Promise<boolean>;
  createWhiteboardGroupShare(input: { id: string; groupId: string }): Promise<void>;
  getWhiteboardGroupShare(id: string): Promise<
    | {
        id: string;
        groupId: string;
        active: boolean;
        createdAt: number;
      }
    | undefined
  >;
  setWhiteboardGroupShare(input: { groupId: string; shareId: string; active: boolean }): Promise<void>;
  stopWhiteboardGroupShare(shareId: string): Promise<boolean>;
  setWhiteboardLectureShare(input: {
    lectureId: string;
    shareId: string;
    active: boolean;
  }): Promise<void>;
  stopWhiteboardShare(shareId: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }

  async createWhiteboardShare(input: {
    id: string;
    scriptText: string;
    ttsEnabled: boolean;
    playbackSpeed: number;
    lectureId?: string | null;
  }): Promise<void> {
    sqlite
      .prepare(
        `INSERT INTO whiteboard_shares (id, script_text, tts_enabled, playback_speed, created_at, active, lecture_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        input.id,
        input.scriptText,
        input.ttsEnabled ? 1 : 0,
        input.playbackSpeed,
        Date.now(),
        input.lectureId ?? null,
      );
  }

  async getWhiteboardShare(id: string) {
    const row = sqlite
      .prepare(
        `SELECT id, script_text, tts_enabled, playback_speed, created_at, active, lecture_id
         FROM whiteboard_shares
         WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          script_text: string;
          tts_enabled: number;
          playback_speed: number;
          created_at: number;
          active: number;
          lecture_id: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      scriptText: row.script_text,
      ttsEnabled: row.tts_enabled === 1,
      playbackSpeed: row.playback_speed,
      createdAt: row.created_at,
      active: row.active === 1,
      lectureId: row.lecture_id,
    };
  }

  async createWhiteboardLecture(input: {
    id: string;
    groupId?: string | null;
    title: string;
    scriptText: string;
    ttsEnabled: boolean;
    playbackSpeed: number;
  }): Promise<void> {
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO whiteboard_lectures
          (id, group_id, title, script_text, tts_enabled, playback_speed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.groupId ?? null,
        input.title,
        input.scriptText,
        input.ttsEnabled ? 1 : 0,
        input.playbackSpeed,
        now,
        now,
      );
  }

  async listWhiteboardLectures() {
    const rows = sqlite
      .prepare(
        `SELECT id, group_id, title, script_text, tts_enabled, playback_speed, share_id, share_active, created_at, updated_at
         FROM whiteboard_lectures
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      group_id: string | null;
      title: string;
      script_text: string;
      tts_enabled: number;
      playback_speed: number;
      share_id: string | null;
      share_active: number;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      title: row.title,
      scriptText: row.script_text,
      ttsEnabled: row.tts_enabled === 1,
      playbackSpeed: row.playback_speed,
      shareId: row.share_id,
      shareActive: row.share_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getWhiteboardLecture(id: string) {
    const row = sqlite
      .prepare(
        `SELECT id, group_id, title, script_text, tts_enabled, playback_speed, share_id, share_active, created_at, updated_at
         FROM whiteboard_lectures
         WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          group_id: string | null;
          title: string;
          script_text: string;
          tts_enabled: number;
          playback_speed: number;
          share_id: string | null;
          share_active: number;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      groupId: row.group_id,
      title: row.title,
      scriptText: row.script_text,
      ttsEnabled: row.tts_enabled === 1,
      playbackSpeed: row.playback_speed,
      shareId: row.share_id,
      shareActive: row.share_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deleteWhiteboardLecture(id: string) {
    const lecture = await this.getWhiteboardLecture(id);
    if (!lecture) return false;
    if (lecture.shareId) await this.stopWhiteboardShare(lecture.shareId);
    sqlite.prepare("DELETE FROM whiteboard_lectures WHERE id = ?").run(id);
    return true;
  }

  async moveWhiteboardLecture(input: { id: string; groupId: string | null }) {
    const result = sqlite
      .prepare("UPDATE whiteboard_lectures SET group_id = ?, updated_at = ? WHERE id = ?")
      .run(input.groupId, Date.now(), input.id);
    return result.changes > 0;
  }

  async createWhiteboardGroup(input: {
    id: string;
    parentId: string | null;
    name: string;
  }): Promise<void> {
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO whiteboard_groups (id, parent_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.parentId, input.name, now, now);
  }

  async listWhiteboardGroups() {
    const rows = sqlite
      .prepare(
        `SELECT id, parent_id, name, share_id, share_active, created_at, updated_at
         FROM whiteboard_groups
         ORDER BY created_at ASC`,
      )
      .all() as Array<{
      id: string;
      parent_id: string | null;
      name: string;
      share_id: string | null;
      share_active: number;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      shareId: row.share_id,
      shareActive: row.share_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async deleteWhiteboardGroup(id: string) {
    const row = sqlite.prepare("SELECT id FROM whiteboard_groups WHERE id = ?").get(id);
    if (!row) return false;
    sqlite.prepare("UPDATE whiteboard_groups SET parent_id = NULL WHERE parent_id = ?").run(id);
    sqlite.prepare("UPDATE whiteboard_lectures SET group_id = NULL WHERE group_id = ?").run(id);
    sqlite.prepare("DELETE FROM whiteboard_groups WHERE id = ?").run(id);
    return true;
  }

  async createWhiteboardGroupShare(input: { id: string; groupId: string }): Promise<void> {
    sqlite
      .prepare(
        `INSERT INTO whiteboard_group_shares (id, group_id, active, created_at)
         VALUES (?, ?, 1, ?)`,
      )
      .run(input.id, input.groupId, Date.now());
  }

  async getWhiteboardGroupShare(id: string) {
    const row = sqlite
      .prepare(
        `SELECT id, group_id, active, created_at
         FROM whiteboard_group_shares
         WHERE id = ?`,
      )
      .get(id) as
      | { id: string; group_id: string; active: number; created_at: number }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      groupId: row.group_id,
      active: row.active === 1,
      createdAt: row.created_at,
    };
  }

  async setWhiteboardGroupShare(input: { groupId: string; shareId: string; active: boolean }) {
    sqlite
      .prepare(
        `UPDATE whiteboard_groups
         SET share_id = ?, share_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.shareId, input.active ? 1 : 0, Date.now(), input.groupId);
  }

  async stopWhiteboardGroupShare(shareId: string) {
    const result = sqlite
      .prepare("UPDATE whiteboard_group_shares SET active = 0 WHERE id = ?")
      .run(shareId);
    sqlite
      .prepare(
        `UPDATE whiteboard_groups
         SET share_active = 0, updated_at = ?
         WHERE share_id = ?`,
      )
      .run(Date.now(), shareId);
    return result.changes > 0;
  }

  async setWhiteboardLectureShare(input: {
    lectureId: string;
    shareId: string;
    active: boolean;
  }): Promise<void> {
    sqlite
      .prepare(
        `UPDATE whiteboard_lectures
         SET share_id = ?, share_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.shareId, input.active ? 1 : 0, Date.now(), input.lectureId);
  }

  async stopWhiteboardShare(shareId: string) {
    const result = sqlite
      .prepare("UPDATE whiteboard_shares SET active = 0 WHERE id = ?")
      .run(shareId);
    sqlite
      .prepare(
        `UPDATE whiteboard_lectures
         SET share_active = 0, updated_at = ?
         WHERE share_id = ?`,
      )
      .run(Date.now(), shareId);
    return result.changes > 0;
  }
}

export const storage = new DatabaseStorage();
