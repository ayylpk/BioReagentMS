-- ════════════════════════════════════════════════════════════════════════════════
-- 03 抽取批次台账（第二阶段 Agent 2：候选关系抽取流水线）
--
-- 纪律（与 02 同款，改这个文件前先读）：
--   · 加性：只有 CREATE TABLE IF NOT EXISTS；绝不 DROP / TRUNCATE / UPDATE 既有业务数据
--   · 幂等：同一份脚本可对已有库重复执行，第二遍不报错
--   · 与 02 完全解耦：本文件不动 reaction_candidate / reaction_rule 任何一列
--
-- 为什么要单独一张表（而不是塞 ingest_log.flags）：
--   ingest_log 是"文档解析摄取"的台账，一行一份文档、status 只有 done/review/quarantined/failed；
--   抽取是**另一条流水线**，同一份文档会跑很多轮（换 extractor_version 就重跑一次），
--   塞进 ingest_log 就必须把"多轮抽取"压成一个字段，重跑历史与失败原因全部丢失。
--   而且 ingest_log 的写入是旁路化降级（MySQL 挂了只 warn），抽取台账要能独立演进。
--
-- 立场：这张表只记"本轮抽取发生了什么"，**不参与任何安全判定**。
--   候选的结论只在 reaction_candidate 里；规则只在 reaction_rule 里（人工审核之后）。
--   台账里出现 0 条候选，绝不等于"这对物质安全"。
-- ════════════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS BioReagentMS;
USE BioReagentMS;

CREATE TABLE IF NOT EXISTS reaction_extract_log (
  id                BIGINT       NOT NULL AUTO_INCREMENT COMMENT '台账主键',
  run_id            VARCHAR(64)  NOT NULL COMMENT '抽取批次 id；(run_id, doc_id) 唯一 → 同一批次重跑是幂等更新，不刷历史行',
  doc_id            VARCHAR(128) NOT NULL COMMENT '被抽取文档 doc_id，口径同 ingest_log.doc_id',
  extractor_version VARCHAR(32)  NOT NULL COMMENT '抽取器版本（如 react-extract/0.1.0）；改判必须靠它，不能靠重复运行',
  status            VARCHAR(16)  NOT NULL COMMENT 'done=抽取跑完（候选数可以为 0）/ empty=没有可抽的 chunk / failed=有 LLM 或落库失败',
  chunks_total      INT          NOT NULL DEFAULT 0 COMMENT '该文档从向量库取到的 chunk 总数',
  chunks_selected   INT          NOT NULL DEFAULT 0 COMMENT '选择阶段判定"该抽"的 chunk 数',
  llm_calls         INT          NOT NULL DEFAULT 0 COMMENT '实际发起的 LLM 调用次数（成本对账用）',
  llm_failures      INT          NOT NULL DEFAULT 0 COMMENT 'LLM 调用失败次数；失败只丢该 chunk，绝不中断文档',
  accepted          INT          NOT NULL DEFAULT 0 COMMENT '通过全部确定性校验的关系条数',
  written           INT          NOT NULL DEFAULT 0 COMMENT '成功写入 reaction_candidate 的条数（含幂等命中已有行）',
  rejected          INT          NOT NULL DEFAULT 0 COMMENT '被确定性校验丢弃的条数（明细见 reject_json）',
  write_failures    INT          NOT NULL DEFAULT 0 COMMENT '候选落库失败次数（DB 故障这类，必须可见）',
  stale_marked      INT          NOT NULL DEFAULT 0 COMMENT '本轮收尾把多少条 pending 旧候选标成 stale（不物理删除）',
  skip_json         JSON         NULL     COMMENT 'chunk 选择跳过原因计数 {"section_not_safety":12,...}',
  reject_json       JSON         NULL     COMMENT '确定性校验拒绝码计数 {"EVIDENCE_NOT_IN_SOURCE":3,...}',
  note_json         JSON         NULL     COMMENT '归一化动作计数 {"coerced_category":2,...}',
  error_text        VARCHAR(1000) NULL    COMMENT '失败摘要（截断，完整原因查服务日志）；成功时为 NULL',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次记录时间',
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_run_doc (run_id, doc_id),
  KEY idx_doc (doc_id, created_at),
  KEY idx_status (status, created_at),
  CONSTRAINT ck_extract_status CHECK (status IN ('done','empty','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试剂禁配候选抽取批次台账：只记过程，不参与任何安全判定';
