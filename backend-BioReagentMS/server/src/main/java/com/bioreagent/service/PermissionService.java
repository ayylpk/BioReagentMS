package com.bioreagent.service;

import java.util.List;
import java.util.Set;

public interface PermissionService {

    public Set<String> getPermissionsByRole(Integer role);

    public void updateRolePermissions(Integer role, List<Integer> permissionIds);

}
