CREATE TABLE IF NOT EXISTS Messages (
    id TEXT PRIMARY KEY,
    groupId TEXT,
    timeStamp INTEGER NOT NULL,
    userName TEXT,
    content TEXT,
    messageId INTEGER,
    groupName TEXT,
    topicId INTEGER  -- 添加 topicId 字段
);
CREATE INDEX IF NOT EXISTS idx_messages_groupid_timestamp
    ON Messages(groupId, timeStamp DESC);

CREATE INDEX IF NOT EXISTS idx_messages_topic  -- 添加 topicId 索引
    ON Messages(groupId, topicId, timeStamp DESC);
