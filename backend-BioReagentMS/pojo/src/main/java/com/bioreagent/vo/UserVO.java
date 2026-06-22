package com.bioreagent.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 用户返回数据VO（不含密码）
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class UserVO {
    private Integer id;           // 用户ID
    private String username;      // 用户名
    private Integer role;         // 角色
    private String roleName;      // 角色名称
    private String name;          // 姓名
    private String email;         // 邮箱
    private String phone;         // 手机号
    private Integer status;       // 状态
    private LocalDateTime createTime; // 创建时间
}
