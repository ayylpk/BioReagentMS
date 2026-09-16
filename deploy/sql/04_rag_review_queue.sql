-- 04_rag_review_queue.sql —— 解析层 L2 人审队列（9/16）
--
-- 为什么要有这张表（补齐"人审那条路"的 B 线）：
--   过闸门不过 / 前门判死 / py 拒收的文档，既往**只把 flags 写进 ingest_log** —— 人能看到"没进去"，
--   却拿不到解析结果本身，也就无从修，唯一出路是删了重传。本表把 profile + Block[] 原文一起存下来，
--   人审才有"可审的料"；确认时人工修正后的 blocks 存档 = 解析层回归评估集的原料（永久留存）。
--   配套：pipeline 在四个非 done 出口落料，service /review 三个端点消费（见 src/rag/store/review.ts）。
--
-- 加性幂等：只有 CREATE TABLE IF NOT EXISTS 与 INSERT ... ON DUPLICATE KEY UPDATE；
--   绝不 DROP / TRUNCATE / UPDATE 既有业务数据。对真实库可反复重跑。
CREATE DATABASE IF NOT EXISTS BioReagentMS;
USE BioReagentMS;

CREATE TABLE IF NOT EXISTS rag_review_queue (
  doc_id        VARCHAR(128) NOT NULL COMMENT '文档身份，口径唯一来源 tsAgent/src/rag/inspect/identity.ts',
  file          VARCHAR(512) NOT NULL COMMENT '盘上原文件绝对路径（确认入库/重摄都要用它）',
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending=待人审 / confirmed=已确认入库 / rejected=已驳回',
  origin        VARCHAR(32)  NOT NULL COMMENT '为什么进来：front-door(L2判死) / parser-reject(拒收) / gate(闸门不过) / needs-upgrade(能力未接)',
  reason        VARCHAR(512) NULL COMMENT '人话理由（红灯/拒收/隔离原因），直接给审核人看',
  flags         TEXT         NULL COMMENT '那一刻的全部 flags（含 diag 账本），换行分隔',
  profile_json  JSON         NULL COMMENT 'DocProfile 原样：family/strategy/magic/前门 notes',
  blocks_json   MEDIUMTEXT   NULL COMMENT '解析出的 Block[] 原文（= 人审要改的对象）',
  edited_blocks MEDIUMTEXT   NULL COMMENT '人工修正后的 Block[]（对照样本；回归评估集原料）',
  blocks_count  INT          NOT NULL DEFAULT 0 COMMENT '进来时解析出多少块（0 = 前门就判死，压根没解析）',
  chunks        INT          NOT NULL DEFAULT 0 COMMENT '确认入库后的切片数',
  reviewed_by   BIGINT       NULL COMMENT '审核人 uid：**只从 JWT 取**，绝不接受客户端自报（审计要求）',
  reviewed_at   TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (doc_id),
  KEY idx_status_updated (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='解析层人审队列：待审文档的档案+解析原文+人工修正存档';

-- ── 权限点（幂等重跑）─────────────────────────────────────────────────────────────
-- 沿用既有 RBAC 口径：permission.code = domain:action，role 0（系统管理员）在 role_permission 里
-- 惯例无行 = 全通，所以这里不给 role 0 插。
INSERT INTO permission (code, name) VALUES
  ('ragReview:query', '解析人审-查询'),
  ('ragReview:audit', '解析人审-确认/驳回')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ragReview:query → role 1(仓库管理员) / 2(实验员) / 4(PI)
INSERT INTO role_permission (role, permission_id)
SELECT v.role, p.id
  FROM (SELECT 1 AS role UNION ALL SELECT 2 AS role UNION ALL SELECT 4 AS role) v
  JOIN permission p ON p.code = 'ragReview:query'
ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id);

-- ragReview:audit → role 1(仓库管理员) / 4(PI)：确认入库会改知识库内容，跟"发布规则"同档
INSERT INTO role_permission (role, permission_id)
SELECT v.role, p.id
  FROM (SELECT 1 AS role UNION ALL SELECT 4 AS role) v
  JOIN permission p ON p.code = 'ragReview:audit'
ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id);
