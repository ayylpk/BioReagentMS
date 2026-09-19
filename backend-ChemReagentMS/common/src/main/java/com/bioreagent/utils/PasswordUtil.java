package com.bioreagent.utils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * 口令散列工具。
 *
 * <p>为什么要有它：此前 user.password 存的是<b>明文</b>，登录时也是明文等值比较 ——
 * 库被拖走、备份或日志泄露，全部账号口令立即失效（而用户往往在别处复用同一个口令）。
 *
 * <p>迁移策略（不打断任何现有账号）：
 * <ul>
 *   <li>新写入一律走 {@link #hash(String)}；</li>
 *   <li>校验走 {@link #matches(String, String)}，其中兼容历史明文
 *       （不是 32 位十六进制就按明文比较）—— 所以库里现存的 {@code 123456} 仍然能登录，
 *       不需要一次性重置所有口令；</li>
 *   <li>要彻底清掉明文：让账号重新登录一次并落新散列，或手工重置种子账号。</li>
 * </ul>
 *
 * <p>实现刻意只用 JDK 自带的 {@link MessageDigest}：common 模块不含 Spring/BCrypt 依赖，
 * 引依赖会让这个纯工具类变成新的构建负担。
 */
public final class PasswordUtil {

    /** 固定盐：与口令混合，避免"同口令 → 同散列"被一眼看出来（本项目没有独立盐列，故取固定值） */
    private static final String SALT = "bioreagent-ms";

    private PasswordUtil() {
    }

    /** 明文 → 32 位十六进制散列；入参为 null 时返回 null */
    public static String hash(String rawPassword) {
        if (rawPassword == null) {
            return null;
        }
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest((SALT + rawPassword).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            // JDK 必然带 MD5，走到这里说明运行环境异常 —— 宁可炸掉也不要退化成明文比较
            throw new IllegalStateException("当前 JVM 不支持 MD5", e);
        }
    }

    /**
     * 校验口令：库里存的是散列就散列比对，存的是历史明文就等值比较。
     *
     * @return 匹配为 true；任一入参为 null 一律 false（不给"空口令登录"留缝）
     */
    public static boolean matches(String rawPassword, String stored) {
        if (rawPassword == null || stored == null) {
            return false;
        }
        if (isHashed(stored)) {
            return hash(rawPassword).equalsIgnoreCase(stored);
        }
        return rawPassword.equals(stored);
    }

    /** 库里存的是不是本工具产出的散列（32 位十六进制） */
    public static boolean isHashed(String stored) {
        return stored != null && stored.matches("^[0-9a-fA-F]{32}$");
    }
}
