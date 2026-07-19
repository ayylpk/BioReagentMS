package com.bioreagent.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Set;

@Mapper
public interface PermissionMapper {

    @Select("SELECT p.code FROM permission p " +
            "JOIN role_permission rp ON p.id = rp.permission_id " +
            "WHERE rp.role = #{role}")
    Set<String> getCodesByRole(Integer role);

    @Delete("DELETE FROM role_permission WHERE role = #{role}")
    void deleteByRole(Integer role);

    void batchInsert(@Param("role") Integer role,
                     @Param("permissionIds") List<Integer> permissionIds);
}
