-- CreateTable
CREATE TABLE "GameWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google-kms',
    "status" TEXT NOT NULL DEFAULT 'unconfigured',
    "accountId" TEXT,
    "publicKey" TEXT,
    "keyVersion" TEXT,
    "provisionRequestedAt" DATETIME,
    "activeOperationId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "lastVerifiedBlock" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'testnet',
    "accountId" TEXT NOT NULL,
    "verifiedPublicKey" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "sessionId" TEXT,
    "purpose" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nonceBase64" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "scope" TEXT,
    "scopeHash" TEXT,
    "operationId" TEXT,
    "targetAccountId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "previewJson" TEXT NOT NULL,
    "intentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "stepsJson" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "sourceAccountId" TEXT NOT NULL,
    "nativeCostCapYocto" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "authorizedAt" DATETIME,
    "authorizationId" TEXT,
    "txHash" TEXT,
    "errorCode" TEXT,
    "resultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletOperation_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "GameWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "callJson" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "unsignedBase64" TEXT NOT NULL,
    "signedBase64" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unsigned',
    "sendAttemptedAt" DATETIME,
    "finalizedHeight" TEXT,
    "receiptJson" TEXT,
    "feeYocto" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameTransaction_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "WalletOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StarterClaim" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "observedClaimed" BOOLEAN,
    "observedBlock" TEXT,
    "txHash" TEXT,
    "checkedAt" DATETIME,
    CONSTRAINT "StarterClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StarterClaim_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "GameWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "windowStartedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SignerWorkerStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nickname" TEXT NOT NULL,
    "nicknameKey" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" DATETIME
);
INSERT INTO "new_User" ("createdAt", "id", "nickname", "nicknameKey", "passwordHash", "updatedAt") SELECT "createdAt", "id", "nickname", "nicknameKey", "passwordHash", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_nicknameKey_key" ON "User"("nicknameKey");
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "authenticatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authMethod" TEXT NOT NULL DEFAULT 'password',
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("createdAt", "expiresAt", "id", "tokenHash", "userId") SELECT "createdAt", "expiresAt", "id", "tokenHash", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "GameWallet_userId_key" ON "GameWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameWallet_accountId_key" ON "GameWallet"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "GameWallet_keyVersion_key" ON "GameWallet"("keyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "GameWallet_activeOperationId_key" ON "GameWallet"("activeOperationId");

-- CreateIndex
CREATE INDEX "ExternalWallet_userId_idx" ON "ExternalWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalWallet_network_accountId_key" ON "ExternalWallet"("network", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletChallenge_nonceBase64_key" ON "WalletChallenge"("nonceBase64");

-- CreateIndex
CREATE INDEX "WalletChallenge_expiresAt_idx" ON "WalletChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "WalletAuthorization_userId_sessionId_idx" ON "WalletAuthorization"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "WalletOperation_status_createdAt_idx" ON "WalletOperation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WalletOperation_userId_createdAt_idx" ON "WalletOperation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletOperation_userId_idempotencyKey_key" ON "WalletOperation"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "GameTransaction_txHash_key" ON "GameTransaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "GameTransaction_operationId_stepIndex_key" ON "GameTransaction"("operationId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "StarterClaim_walletId_key" ON "StarterClaim"("walletId");
