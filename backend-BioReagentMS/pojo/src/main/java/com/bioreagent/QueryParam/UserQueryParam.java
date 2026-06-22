package com.bioreagent.QueryParam;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户分页查询参数
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class UserQueryParam {
    private Integer page = 1;
    private Integer pageSize = 10;
    private String username;          // 用户名（模糊查询）
    private String name;              // 姓名（模糊查询）
    private Integer role;             // 角色
    private Integer status;           // 状态
}
