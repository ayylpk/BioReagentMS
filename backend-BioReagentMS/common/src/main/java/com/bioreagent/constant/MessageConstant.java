package com.bioreagent.constant;

/**
 * 信息提示常量类
 */
public class MessageConstant {

    // ── 登录 ──
    public static final String USER_NOT_FOUND = "用户不存在";
    public static final String USERNAME_OR_PASSWORD_ERROR = "用户名或密码错误";
    public static final String USER_NOT_LOGIN = "用户未登录";

    // ── 出库 ──
    public static final String OUTBOUND_APPROVED_NO_MODIFY = "该出库单已通过审批，不允许修改";
    public static final String OUTBOUND_APPROVED_NO_DELETE = "该出库单已通过审批，不允许删除";
    public static final String STOCK_INSUFFICIENT = "库存不足";

    // ── 预警 ──
    public static final String WARNING_NOT_FOUND = "预警记录不存在";
    public static final String WARNING_ALREADY_RESOLVED = "该预警已经是已处理状态";
    public static final String WARNING_STILL_EXPIRING = "批次仍处于即将过期状态";
    public static final String WARNING_STILL_SHORTAGE = "库存仍低于安全阈值";
    public static final String STOCK_DROPPED_TO_ZERO = "库存已降至 0，已生成新预警";

    // ── 通用 ──
    public static final String NO_PERMISSION = "无权限";
    public static final String UNKNOWN_ERROR = "未知错误";
}
