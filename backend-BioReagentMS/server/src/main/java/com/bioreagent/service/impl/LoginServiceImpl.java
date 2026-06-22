package com.bioreagent.service.impl;


import com.bioreagent.constant.JwtClaimsConstant;
import com.bioreagent.entity.User;
import com.bioreagent.mapper.UserMapper;
import com.bioreagent.properties.JwtProperties;
import com.bioreagent.result.Result;
import com.bioreagent.service.LoginService;
import com.bioreagent.utils.JwtUtil;
import com.bioreagent.vo.LoginVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class LoginServiceImpl implements LoginService {

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private JwtProperties jwtProperties;

    @Override
    public Result<LoginVO> login(String username, String password) {
        User user = userMapper.getByUsername(username);

        if(user == null){
            return Result.error("用户不存在");
        }

        String passwordInDB = user.getPassword();
        if (!password.equals(passwordInDB)) {
            return Result.error("用户名或密码错误");
        }

        LoginVO loginVO = new LoginVO();
        Map<String, Object> claims = new HashMap<>();
        claims.put(JwtClaimsConstant.USER_ID, user.getId());
        claims.put(JwtClaimsConstant.ROLE, user.getRole());
        String token = JwtUtil.createJWT(jwtProperties.getSecretKey(), jwtProperties.getTtl(), claims);
        loginVO.setAccessToken(token);
        loginVO.setUserId(user.getId());
        loginVO.setRole(user.getRole());
        loginVO.setUsername(user.getUsername());

        return Result.success(loginVO);
    }
}
