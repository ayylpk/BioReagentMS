create database BioReagentMS;

use BioReagentMS;

CREATE TABLE user (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    password    VARCHAR(100) NOT NULL,
    role        INT          NOT NULL COMMENT '0-系统管理员 1-仓库管理员 2-实验员 3-采购员 4-PI',
    role_name   VARCHAR(20),
    name        VARCHAR(50),
    email       VARCHAR(100),
    phone       VARCHAR(20),
    status      INT          DEFAULT 1 COMMENT '0-禁用 1-正常',
    create_time DATETIME
) COMMENT '用户表';

CREATE TABLE supplier (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    name     VARCHAR(100) NOT NULL,
    linkman  VARCHAR(50),
    phone    VARCHAR(20),
    address  VARCHAR(200),
    e_mail   VARCHAR(100)
) COMMENT '供应商表';

CREATE TABLE reagent (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    name                    VARCHAR(200) NOT NULL,
    cas_number              VARCHAR(50),
    specification           VARCHAR(100),
    purity                  VARCHAR(50),
    category_id             BIGINT,
    unit                    VARCHAR(20),
    storage_condition       VARCHAR(100) COMMENT '常温/2-8℃/-20℃/避光',
    safety_stock_threshold  INT          COMMENT '安全库存阈值',
    warning_advance_days    INT          COMMENT '效期提前预警天数',
    status                  INT          DEFAULT 0 COMMENT '0-启用 1-禁用',
    create_time             DATE
) COMMENT '试剂主表';

CREATE TABLE reagent_batch (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    reagent_id          BIGINT       NOT NULL,
    batch_number        VARCHAR(100) NOT NULL,
    production_date     DATE,
    expiry_date         DATE,
    opened_expiry_days  INT          COMMENT '开封后有效天数',
    opened_date         DATE,
    initial_quantity    INT          COMMENT '入库数量',
    current_quantity    INT          COMMENT '当前余量',
    unit_price          DOUBLE       COMMENT '采购单价',
    storage_location    VARCHAR(100) COMMENT '存储位置',
    supplier_id         VARCHAR(50),
    status              INT          DEFAULT 0 COMMENT '0-在库 1-已开封 2-已用完 3-已过期',
    remark              VARCHAR(500),
    create_time         DATETIME,
    FOREIGN KEY (reagent_id) REFERENCES reagent(id)
) COMMENT '批次库存表';

CREATE TABLE warehouse_receipt (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    receipt_number  VARCHAR(100) NOT NULL,
    reagent_id      BIGINT       NOT NULL,
    reagent_name    VARCHAR(200),
    quantity        INT          NOT NULL,
    unit_price      DOUBLE,
    operator_id     INT,
    operator_name   VARCHAR(50),
    receipt_time    DATETIME,
    remark          VARCHAR(500)
) COMMENT '入库单表';

CREATE TABLE delivery_order (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    order_number     VARCHAR(100) NOT NULL,
    reagent_id       INT,
    reagent_name     VARCHAR(200),
    batch_id         BIGINT       COMMENT '出库批次ID',
    quantity         INT          NOT NULL,
    operator_id      INT,
    operator_name    VARCHAR(50),
    delivery_time    DATETIME     COMMENT '出库时间',
    status           INT          DEFAULT 0 COMMENT '-1-已取消 0-待审核 1-已通过 2-已拒绝',
    approver_id      INT,
    approver_name    VARCHAR(50),
    approval_time    DATETIME,
    rejection_reason VARCHAR(500),
    remark           VARCHAR(500),
    create_time      DATETIME
) COMMENT '出库单表';

CREATE TABLE warning_record (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    reagent_id    INT          COMMENT '试剂ID',
    reagent_name  VARCHAR(200) COMMENT '试剂名称',
    reagent_batch VARCHAR(100) COMMENT '试剂批号',
    warning_type  VARCHAR(50)  COMMENT 'EXPIRE-效期临近 SHORTAGE-库存不足',
    trigger_time  DATETIME,
    status        INT          DEFAULT 0 COMMENT '0-未处理 1-已处理',
    resolve_time  DATETIME,
    resolved_by   INT
) COMMENT '预警记录表';

CREATE TABLE operation_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    operator_id BIGINT,
    module      VARCHAR(50)  COMMENT '模块名',
    action      VARCHAR(20)  COMMENT '操作类型',
    target_id   VARCHAR(50),
    detail      VARCHAR(500),
    create_time DATETIME
) COMMENT '操作日志表';

INSERT INTO user (username, password, role, role_name, name, status, create_time) VALUES
('admin',      '123456', 0, '系统管理员',   '张三', 1, NOW()),
('warehouse',  '123456', 1, '仓库管理员',   '李四', 1, NOW()),
('labuser',    '123456', 2, '普通实验人员', '王五', 1, NOW()),
('purchaser',  '123456', 3, '采购人员',     '赵六', 1, NOW()),
('pi',         '123456', 4, '课题负责人',   '钱七', 1, NOW());

INSERT INTO supplier (name, linkman, phone, address, e_mail) VALUES
('国药集团化学试剂有限公司', '陈经理', '13800001111', '上海市黄浦区', 'chen@sinopharm.cn'),
('上海阿拉丁生化科技股份有限公司', '刘经理', '13800002222', '上海市浦东新区', 'liu@aladdin.cn'),
('西格玛奥德里奇(上海)贸易有限公司', '王经理', '13800003333', '上海市徐汇区', 'wang@sigmaaldrich.cn');

INSERT INTO reagent (id, name, cas_number, specification, purity, category_id, unit, storage_condition, safety_stock_threshold, warning_advance_days, status, create_time) VALUES
(1, '氯化钠',          '7647-14-5',  'AR/500g',     '分析纯', 1, '瓶', '常温',   2,  30, 0, CURDATE()),
(2, '无水乙醇',        '64-17-5',    'AR/500mL',    '分析纯', 1, '瓶', '常温',   3,  30, 0, CURDATE()),
(3, '甲醇',            '67-56-1',    'HPLC/4L',     '色谱纯', 1, '瓶', '常温',   2,  30, 0, CURDATE()),
(4, '二甲基亚砜(DMSO)','67-68-5',    '99.9%/500mL', '细胞级', 2, '瓶', '常温',   2,  60, 0, CURDATE()),
(5, '胰蛋白酶',        '9002-07-7',  '1:250/25g',   '生化级', 3, '瓶', '-20℃',  1,  90, 0, CURDATE());

INSERT INTO reagent_batch (reagent_id, batch_number, production_date, expiry_date, initial_quantity, current_quantity, unit_price, storage_location, supplier_id, status, create_time) VALUES
(1, 'BN-1-20260101-001', '2026-01-01', '2028-01-01', 10, 8,  25.00, 'A-01-03', '1', 0, NOW()),
(1, 'BN-1-20260401-001', '2026-04-01', '2028-04-01', 5,  5,  28.00, 'A-01-03', '1', 0, NOW()),
(2, 'BN-2-20260201-001', '2026-02-01', '2027-08-01', 8,  6,  18.00, 'A-02-01', '2', 0, NOW()),
(2, 'BN-2-20260501-001', '2026-05-01', '2028-05-01', 10, 10, 20.00, 'A-02-01', '2', 0, NOW()),
(3, 'BN-3-20260301-001', '2026-03-01', '2027-09-01', 6,  4,  45.00, 'B-01-02', '3', 0, NOW()),
(3, 'BN-3-20260601-001', '2026-06-01', '2028-06-01', 4,  4,  48.00, 'B-01-02', '3', 0, NOW()),
(4, 'BN-4-20260115-001', '2026-01-15', '2028-01-15', 3,  3,  120.00, 'B-02-01', '1', 0, NOW()),
(5, 'BN-5-20260315-001', '2026-03-15', '2027-03-15', 2,  1,  350.00, 'C-Freezer-01', '2', 1, NOW()),
(5, 'BN-5-20260610-001', '2026-06-10', '2028-06-10', 2,  2,  360.00, 'C-Freezer-01', '2', 0, NOW());

INSERT INTO warehouse_receipt (receipt_number, reagent_id, reagent_name, quantity, unit_price, operator_id, operator_name, receipt_time) VALUES
('IN-20260601-001', 1, '氯化钠',          10, 25.00, 2, '李四', '2026-06-01 09:30:00'),
('IN-20260601-002', 1, '氯化钠',          5,  28.00, 2, '李四', '2026-06-01 10:00:00'),
('IN-20260602-001', 2, '无水乙醇',        8,  18.00, 2, '李四', '2026-06-02 14:00:00'),
('IN-20260603-001', 3, '甲醇',            6,  45.00, 2, '李四', '2026-06-03 11:00:00'),
('IN-20260604-001', 5, '胰蛋白酶',        2,  360.00, 2, '李四', '2026-06-04 08:30:00');

INSERT INTO delivery_order (order_number, reagent_id, reagent_name, batch_id, quantity, operator_id, operator_name, status, create_time) VALUES
('OUT-20260610-001', 1, '氯化钠',   1, 2, 3, '王五', 0, '2026-06-10 15:00:00'),
('OUT-20260605-001', 2, '无水乙醇', 3, 2, 3, '王五', 1, '2026-06-05 10:00:00');

INSERT INTO warning_record (reagent_id, reagent_name, reagent_batch, warning_type, trigger_time, status) VALUES
(5, '胰蛋白酶', 'BN-5-20260315-001', 'EXPIRE', '2026-06-18 00:00:00', 0),
(4, 'DMSO',     null,                 'SHORTAGE', '2026-06-18 00:00:00', 0);