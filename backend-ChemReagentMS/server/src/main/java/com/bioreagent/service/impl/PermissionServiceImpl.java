package com.bioreagent.service.impl;

import com.bioreagent.mapper.PermissionMapper;
import com.bioreagent.service.PermissionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

@Service
public class PermissionServiceImpl implements PermissionService {

    @Autowired
    private PermissionMapper permissionMapper;

    @Cacheable(value = "rolePermission", key = "#role")
    @Override
    public Set<String> getPermissionsByRole(Integer role) {
        return permissionMapper.getCodesByRole(role);
    }

    @CacheEvict(value = "rolePermission", key = "#role")
    @Override
    public void updateRolePermissions(Integer role, List<Integer> permissionIds) {
        permissionMapper.deleteByRole(role);                // 先清旧的
        permissionMapper.batchInsert(role, permissionIds);  // 再插新的（XML里写foreach）
    }

}
