import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
it('preserves existing passwords, sessions, chats and messages during the player migration', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const folders = readdirSync('prisma/migrations')
      .filter((x) => /^\d/.test(x))
      .sort();
    const latest = '20261113010000_player_game_wallets';
    for (const folder of folders.filter((x) => x < latest))
      db.exec(
        readFileSync(`prisma/migrations/${folder}/migration.sql`, 'utf8'),
      );
    db.exec(`INSERT INTO User(id,nickname,nicknameKey,passwordHash,updatedAt) VALUES('legacy','Legacy','legacy','existing-hash',CURRENT_TIMESTAMP);
  INSERT INTO Session(id,tokenHash,userId,expiresAt) VALUES('session','old-token','legacy','2099-01-01');
  INSERT INTO Chat(id,userId,title,updatedAt) VALUES('chat','legacy','Preserved chat',CURRENT_TIMESTAMP);
  INSERT INTO Message(chatId,role,content) VALUES('chat','user','Preserved message');`);
    db.exec(readFileSync(`prisma/migrations/${latest}/migration.sql`, 'utf8'));
    expect(
      db
        .prepare('SELECT passwordHash,authVersion FROM User WHERE id=?')
        .get('legacy'),
    ).toMatchObject({ passwordHash: 'existing-hash', authVersion: 0 });
    expect(
      db
        .prepare(
          'SELECT tokenHash,authMethod,authVersion FROM Session WHERE id=?',
        )
        .get('session'),
    ).toMatchObject({
      tokenHash: 'old-token',
      authMethod: 'password',
      authVersion: 0,
    });
    expect(
      db.prepare('SELECT title FROM Chat WHERE id=?').get('chat'),
    ).toMatchObject({ title: 'Preserved chat' });
    expect(
      db.prepare('SELECT content FROM Message WHERE chatId=?').get('chat'),
    ).toMatchObject({ content: 'Preserved message' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});
