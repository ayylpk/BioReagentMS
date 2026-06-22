package com.bioreagent.constant;

public class RoleConstant {
    // 系统管理员：拥有系统全部权限
    public static final Integer SYSTEM_ADMIN = 0;
    
    // 仓库管理员（库管）：负责试剂档案维护、入库登记、出库审核等
    public static final Integer WAREHOUSE_MANAGER = 1;
    
    // 普通实验人员：可进行库存查询、提交领用申请等
    public static final Integer LAB_USER = 2;
    
    // 采购人员：可查看库存不足预警、生成采购建议等
    public static final Integer PURCHASER = 3;
    
    // 课题负责人（PI）：可查看课题组领用统计、成本核算等
    public static final Integer PI_LEADER = 4;
}
