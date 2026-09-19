package com.bioreagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户接收参数DTO
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class UserDTO {
    private Integer id; // 用户ID
    private String username; // 用户名
    private String password; // 加密密码
    private Integer role; // 角色：0-系统管理员，1-仓库管理员，2-普通实验人员，3-采购人员，4-课题负责人
    private String roleName; // 角色名称
    private String name; // 姓名
    private String email; // 邮箱
    private String phone; // 手机号
    private Integer status; // 状态：0-禁用，1-正常
}
