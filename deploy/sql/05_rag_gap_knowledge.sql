-- 05_rag_gap_knowledge.sql —— 缺口知识表（9/16）：本地库没查到时，AI 生成的通用参考落这里等人工确认
--
-- 为什么进 MySQL 而不进向量库：
--   写入侧的纪律是"chunk 正文不许掺 LLM 生成内容"（见 tsAgent/src/rag/chunk/bySection.ts 红线），
--   而这个系统靠"溯源到 SDS 原文"吃饭。生成内容直接进向量库 = 把生成物伪装成文献证据。
--   所以：模型产出 → 本表 pending → 人在「缺口知识」页点完成/修正 → 状态 done。
--   done 之后的价值来自**同问题复用**（store/gap.ts 的 findReusable），而不是检索。
--
-- question_hash：问题归一化（NFKC + 去空白/标点 + 小写）后的 sha1，UNIQUE。
--   没有它，同一个问题会被反复生成、反复插行，表很快变成垃圾场。
--
-- 加性幂等：只有 CREATE TABLE IF NOT EXISTS 与 INSERT ... ON DUPLICATE KEY UPDATE。
CREATE DATABASE IF NOT EXISTS BioReagentMS;
USE BioReagentMS;

CREATE TABLE IF NOT EXISTS rag_gap_knowledge (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  question       VARCHAR(1000) NOT NULL COMMENT '用户原始问题（原样留存，便于人工照原话判断）',
  question_hash  CHAR(40)     NOT NULL COMMENT '归一化问题的 sha1：同句不同写法落同一条（唯一键）',
  answer         MEDIUMTEXT   NULL COMMENT '模型生成的通用参考（含免责声明）；人工点完成时可直接改写',
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending=待确认 / done=已确认（之后同问题复用）/ ignored=已忽略（看过没价值，不再复用）',
  route          VARCHAR(16)  NULL COMMENT '哪条路空手进来的：knowledge（db/reaction 空手不生成，所以只有它）',
  model          VARCHAR(64)  NULL COMMENT '生成用的模型名（追溯"这段话是谁写的"）',
  near_misses    JSON         NULL COMMENT '检索到的弱命中线索（人工补资料时知道差在哪）',
  ask_count      INT          NOT NULL DEFAULT 1 COMMENT '被问次数：同时是"该优先补哪块资料"的排序依据',
  reviewed_by    BIGINT       NULL COMMENT '确认人 uid：只从 JWT 取，不接受客户端自报',
  reviewed_at    TIMESTAMP    NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_question_hash (question_hash),
  KEY idx_status_ask (status, ask_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='缺口知识：本地库无依据时 AI 生成的参考回答 + 人工确认状态';

-- ── 权限点（幂等重跑）─────────────────────────────────────────────────────────────
-- 沿用既有 RBAC 口径：permission.code = domain:action，role 0（系统管理员）惯例全通，不插行。
INSERT INTO permission (code, name) VALUES
  ('gapKnowledge:query', '缺口知识-查询'),
  ('gapKnowledge:audit', '缺口知识-完成/忽略')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- gapKnowledge:query → role 1(仓库管理员) / 2(实验员) / 4(PI)
INSERT INTO role_permission (role, permission_id)
SELECT v.role, p.id
  FROM (SELECT 1 AS role UNION ALL SELECT 2 AS role UNION ALL SELECT 4 AS role) v
  JOIN permission p ON p.code = 'gapKnowledge:query'
ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id);

-- gapKnowledge:audit → role 1 / 4：确认后的内容会被后续问答复用，等同于"把它当成库里的说法"
INSERT INTO role_permission (role, permission_id)
SELECT v.role, p.id
  FROM (SELECT 1 AS role UNION ALL SELECT 4 AS role) v
  JOIN permission p ON p.code = 'gapKnowledge:audit'
ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id);
