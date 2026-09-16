-- ════════════════════════════════════════════════════════════════════════════════
-- 02 试剂禁配 / 相容性安全知识（第二阶段 Agent 1：数据模型与契约）
--
-- 纪律（改这个文件前先读）：
--   · 加性：只有 CREATE TABLE IF NOT EXISTS / 条件 ADD INDEX / INSERT ... ON DUPLICATE KEY UPDATE
--   · 幂等：同一份脚本可对已有库重复执行，第二遍不报错、不重复插数据
--   · 绝不 DROP / TRUNCATE / UPDATE 既有业务数据
--   · 不塞任何示例规则：空表 + "没有记录"必须能被上层区分，绝不许把空表当成"兼容/安全"
--
-- 关系方向：本阶段四类关系（禁配 / 分开储存 / 危险反应 / 条件共存）语义全部对称，
--           落库前按规范化顺序排好，A-B 与 B-A 只存一份。方向语义显式写进 direction_semantics
--           列（恒为 'symmetric'），不靠注释口口相传。
-- ════════════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS BioReagentMS;
USE BioReagentMS;

-- ── reagent 补索引 ────────────────────────────────────────────────────────────────
-- 现状：reagent 只有 PRIMARY(id)，name / cas_number 全无索引；CAS 绑定与名称查询却要按它们查。
-- cas_number 只加普通索引不加 UNIQUE：现网存在同 CAS 多行的可能性（批次级记录/历史脏数据），
-- 唯一化会让迁移在已有库上直接失败，违反"可在已有库上执行"。
-- MySQL 8 无 ADD INDEX IF NOT EXISTS，用 information_schema 判定 + 动态 SQL 保证可重跑。
SET @ddl := IF(
  EXISTS(SELECT 1 FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'reagent' AND index_name = 'idx_reagent_name'),
  'SELECT 1',
  'ALTER TABLE reagent ADD INDEX idx_reagent_name (name)');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  EXISTS(SELECT 1 FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'reagent' AND index_name = 'idx_reagent_cas'),
  'SELECT 1',
  'ALTER TABLE reagent ADD INDEX idx_reagent_cas (cas_number)');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 候选表：抽取流水线产出、等人审，未确认前不对外作答 ──────────────────────────────
-- 两个维度正交，别混：
--   review_status  审核维度：pending/approved/rejected/superseded
--   source_state   来源有效性维度：active/stale
-- 重摄让 source_chunk_seq / evidence_text 漂移 → candidate_key 变化 → 旧行变孤儿，
-- 所以来源失效只标 stale（不物理删除），等复核。
CREATE TABLE IF NOT EXISTS reaction_candidate (
  id                  BIGINT       NOT NULL AUTO_INCREMENT COMMENT '候选主键',
  candidate_key       CHAR(40)     NOT NULL COMMENT '幂等键 sha1(relation_type|pair_key|source_doc_id|source_chunk_seq|evidence_quote 规范化)：同一条证据重复抽取不产生重复行',
  relation_type       VARCHAR(32)  NOT NULL COMMENT 'incompatible 禁配 / storage_separate 分开储存 / hazardous_reaction 危险反应 / conditionally_compatible 条件共存',
  direction_semantics VARCHAR(16)  NOT NULL DEFAULT 'symmetric' COMMENT '关系方向语义：本阶段四类关系全部对称（A-B 等价 B-A），显式落库防止靠注释口口相传',
  subject_kind        VARCHAR(16)  NOT NULL COMMENT '实体类型 reagent 具体试剂 / category 类别，两者绝不许混为同一实体',
  object_kind         VARCHAR(16)  NOT NULL COMMENT '同 subject_kind',
  subject_key         VARCHAR(255) NOT NULL COMMENT '规范化实体键：cas:<CAS> / name:<规范名> / cat:<规范名>；方向已规范化，store 侧保证 subject_key 与 object_key 有序',
  object_key          VARCHAR(255) NOT NULL COMMENT '同 subject_key',
  pair_key            VARCHAR(512) NOT NULL COMMENT '两个实体键按规范化顺序拼接，四种对称关系共用，是对称去重的唯一依据',
  subject_name        VARCHAR(200) NOT NULL COMMENT '抽取时的实体显示名快照（与方向一同排序，不保留原文出现顺序）',
  object_name         VARCHAR(200) NOT NULL COMMENT '同 subject_name',
  subject_cas         VARCHAR(50)  NULL     COMMENT 'reagent 且带 CAS 时落库；category 恒 NULL',
  object_cas          VARCHAR(50)  NULL     COMMENT '同 subject_cas',
  severity            VARCHAR(16)  NOT NULL DEFAULT 'unknown' COMMENT 'low/medium/high/critical/unknown；unknown 表示未评估，绝不表示不危险',
  hazards_json        JSON         NULL     COMMENT '危害集合：heat/fire/explosion/toxic_gas/flammable_gas/pressure/polymerization/decomposition/other',
  conditions_json     JSON         NULL     COMMENT 'conditionally_compatible 的共存条件（如 {"temp_max_c":40}），其余关系可空',
  confidence          DECIMAL(4,3) NULL     COMMENT '抽取置信度 0.000~1.000；mysql2 读回是字符串，store 层统一 Number() 归一',
  extractor_version   VARCHAR(32)  NOT NULL COMMENT '抽取器版本，溯源用（例 react-extract/0.1.0），必须显式提供不许留空',
  evidence_text       TEXT         NOT NULL COMMENT '证据原文：必须是被摄 chunk 里的连续片段，store 写入前断言 contains',
  source_doc_id       VARCHAR(128) NOT NULL COMMENT '来源文档 doc_id，口径同 ingest_log.doc_id',
  source_chunk_id     CHAR(36)     NOT NULL COMMENT '来源 chunk 的确定性 point id（UUIDv5，可由 doc_id+seq 复算）',
  source_chunk_seq    INT          NOT NULL COMMENT '来源 chunk 序号；重摄会漂移，故证据本身另存快照',
  source_page         INT          NULL     COMMENT '来源页码；docx/无页概念文档为 NULL',
  source_section      VARCHAR(200) NULL     COMMENT '来源叶子分节名',
  source_table_id     VARCHAR(191) NULL     COMMENT '来源表格稳定标识 doc_id#blockIndex；非表格证据为 NULL',
  source_bbox_json    JSON         NULL     COMMENT '来源坐标 [x1,y1,x2,y2]；无坐标时为 NULL',
  last_seen_run_id    VARCHAR(64)  NOT NULL COMMENT '最后一次见到该证据的抽取批次 id，重摄后用于判定来源失效',
  review_status       VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT '审核维度：pending/approved/rejected/superseded',
  source_state        VARCHAR(16)  NOT NULL DEFAULT 'active'  COMMENT '来源有效性维度：active/stale；与 review_status 正交',
  reviewed_by         INT          NULL     COMMENT '审核人 user.id',
  reviewed_at         DATETIME     NULL     COMMENT '审核时间',
  review_note         VARCHAR(500) NULL     COMMENT '审核备注',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次入库时间',
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间（含 last_seen_run_id 刷新）',
  PRIMARY KEY (id),
  UNIQUE KEY uk_candidate_key (candidate_key),
  KEY idx_pair (pair_key),
  KEY idx_subject (subject_key),
  KEY idx_object (object_key),
  KEY idx_review_queue (review_status, source_state, created_at),
  KEY idx_source_doc (source_doc_id, source_state, last_seen_run_id),
  CONSTRAINT ck_candidate_relation CHECK (relation_type IN ('incompatible','storage_separate','hazardous_reaction','conditionally_compatible')),
  CONSTRAINT ck_candidate_direction CHECK (direction_semantics IN ('symmetric')),
  CONSTRAINT ck_candidate_kind CHECK (subject_kind IN ('reagent','category') AND object_kind IN ('reagent','category')),
  CONSTRAINT ck_candidate_review CHECK (review_status IN ('pending','approved','rejected','superseded')),
  CONSTRAINT ck_candidate_source CHECK (source_state IN ('active','stale')),
  CONSTRAINT ck_candidate_severity CHECK (severity IN ('low','medium','high','critical','unknown')),
  CONSTRAINT ck_candidate_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试剂禁配候选表：抽取产出、待人工审核，未确认前不对外作答';

-- ── 正式规则表：仅人工审核通过后写入，是查询工具唯一可作答的事实来源 ───────────────────
-- 业务不变量：同一 rule_key 不允许同时存在两条 status='active'。
--   不用唯一索引表达：同一对物质允许来自多条证据（多条规则），唯一索引会误杀。
--   由 store.publishRule 在事务内 SELECT ... FOR UPDATE 串行化住（REPEATABLE READ 下 gap lock）。
-- 来源失效不物理删除：文档重摄 → source_stale；文档删除 → source_missing；等复核。
CREATE TABLE IF NOT EXISTS reaction_rule (
  id                  BIGINT       NOT NULL AUTO_INCREMENT COMMENT '规则主键',
  candidate_id        BIGINT       NOT NULL COMMENT '来源候选 reaction_candidate.id；一个候选最多发布一条规则（UNIQUE）',
  rule_key            CHAR(40)     NOT NULL COMMENT '业务键 sha1(relation_type|pair_key)；同一 rule_key 允许多条（同一对物质可有多个证据来源）',
  relation_type       VARCHAR(32)  NOT NULL COMMENT '同 reaction_candidate.relation_type',
  direction_semantics VARCHAR(16)  NOT NULL DEFAULT 'symmetric' COMMENT '本阶段恒为 symmetric（四类关系语义全对称）',
  subject_kind        VARCHAR(16)  NOT NULL COMMENT 'reagent / category，不许混为同一实体',
  object_kind         VARCHAR(16)  NOT NULL COMMENT '同 subject_kind',
  subject_key         VARCHAR(255) NOT NULL COMMENT '规范化实体键（方向已规范化）',
  object_key          VARCHAR(255) NOT NULL COMMENT '规范化实体键（方向已规范化）',
  pair_key            VARCHAR(512) NOT NULL COMMENT '两实体键排序拼接，冗余落库便于排查与成对查询（= rule_key 的输入）',
  subject_name        VARCHAR(200) NOT NULL COMMENT '显示名快照',
  object_name         VARCHAR(200) NOT NULL COMMENT '显示名快照',
  subject_cas         VARCHAR(50)  NULL     COMMENT 'CAS 快照；reagent 无 CAS / category 时为 NULL',
  object_cas          VARCHAR(50)  NULL     COMMENT 'CAS 快照',
  severity            VARCHAR(16)  NOT NULL DEFAULT 'unknown' COMMENT 'low/medium/high/critical/unknown；unknown 表示未评估',
  hazards_json        JSON         NULL     COMMENT '危害集合快照',
  conditions_json     JSON         NULL     COMMENT '共存条件快照',
  confidence          DECIMAL(4,3) NULL     COMMENT '发布时从候选快照的置信度；mysql2 读回是字符串，store 层 Number() 归一',
  extractor_version   VARCHAR(32)  NOT NULL COMMENT '来源抽取器版本快照',
  evidence_text       TEXT         NOT NULL COMMENT '证据原文快照（发布后不再随重摄变化，复核时以此为准）',
  source_doc_id       VARCHAR(128) NOT NULL COMMENT '来源文档 doc_id 快照',
  source_chunk_id     CHAR(36)     NOT NULL COMMENT '来源 chunk point id 快照',
  source_chunk_seq    INT          NOT NULL COMMENT '来源 chunk seq 快照',
  source_page         INT          NULL     COMMENT '来源页码快照',
  source_section      VARCHAR(200) NULL     COMMENT '来源分节快照',
  source_table_id     VARCHAR(191) NULL     COMMENT '来源表格标识快照',
  source_bbox_json    JSON         NULL     COMMENT '来源坐标快照',
  status              VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active 生效 / superseded 已被新规则取代',
  superseded_by_id    BIGINT       NULL     COMMENT '取代它的规则 id（自引用，只做索引不做外键：避免自引用删除顺序约束）',
  superseded_at       DATETIME     NULL     COMMENT '取代时间',
  source_state        VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active 来源仍在 / source_stale 来源文档被重摄（chunk 可能漂移）/ source_missing 来源文档已删；一律不物理删除',
  source_rechecked_by INT          NULL     COMMENT '来源复核人 user.id：source_state 由失效态回到 active 必须留痕，否则"何时由谁确认来源仍在"无从追查',
  source_rechecked_at DATETIME     NULL     COMMENT '来源复核时间',
  reviewed_by         INT          NULL     COMMENT '发布人 user.id',
  reviewed_at         DATETIME     NULL     COMMENT '发布时间',
  review_note         VARCHAR(500) NULL     COMMENT '发布备注',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入库时间',
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_candidate (candidate_id),
  KEY idx_rule_key (rule_key, status),
  KEY idx_pair (pair_key),
  KEY idx_subject (subject_key),
  KEY idx_object (object_key),
  KEY idx_active (status, source_state, relation_type),
  KEY idx_source_doc (source_doc_id, source_state),
  KEY idx_superseded_by (superseded_by_id),
  CONSTRAINT fk_rule_candidate FOREIGN KEY (candidate_id) REFERENCES reaction_candidate (id),
  CONSTRAINT ck_rule_relation CHECK (relation_type IN ('incompatible','storage_separate','hazardous_reaction','conditionally_compatible')),
  CONSTRAINT ck_rule_direction CHECK (direction_semantics IN ('symmetric')),
  CONSTRAINT ck_rule_kind CHECK (subject_kind IN ('reagent','category') AND object_kind IN ('reagent','category')),
  CONSTRAINT ck_rule_status CHECK (status IN ('active','superseded')),
  CONSTRAINT ck_rule_source CHECK (source_state IN ('active','source_stale','source_missing')),
  CONSTRAINT ck_rule_severity CHECK (severity IN ('low','medium','high','critical','unknown')),
  CONSTRAINT ck_rule_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试剂禁配正式规则表：仅人工审核通过后写入，是查询工具唯一可作答的事实来源';

-- ── 权限点（幂等重跑）─────────────────────────────────────────────────────────────
-- 沿用既有 RBAC 口径：permission.code = domain:action，role 0（系统管理员）在 role_permission 里
-- 惯例无行 = 全通，所以这里不给 role 0 插。
INSERT INTO permission (code, name) VALUES
  ('reactionReview:query', '试剂禁配审核-查询'),
  ('reactionReview:audit', '试剂禁配审核-审核')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- reactionReview:query → role 1(仓库管理员) / 2(实验员) / 4(PI)
INSERT INTO role_permission (role, permission_id)
SELECT v.role, p.id
  FROM (SELECT 1 AS role UNION ALL SELECT 2 AS role UNION ALL SELECT 4 AS role) v
  JOIN permission p ON p.code = 'reactionReview:query'
ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id);

-- reactionReview:audit → role 1(仓库管理员) / 4(PI)
INSERT INTO role_permission (role, permission_id)
SELECT v.role, p.id
  FROM (SELECT 1 AS role UNION ALL SELECT 4 AS role) v
  JOIN permission p ON p.code = 'reactionReview:audit'
ON DUPLICATE KEY UPDATE permission_id = VALUES(permission_id);
