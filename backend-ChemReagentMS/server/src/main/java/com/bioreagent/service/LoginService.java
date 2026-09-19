package com.bioreagent.service;

import com.bioreagent.result.Result;
import com.bioreagent.vo.LoginVO;

public interface LoginService {
    Result<LoginVO> login(String username, String password);
}
