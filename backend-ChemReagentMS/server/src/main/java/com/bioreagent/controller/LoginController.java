package com.bioreagent.controller;


import com.bioreagent.dto.LoginDTO;
import com.bioreagent.result.Result;
import com.bioreagent.service.LoginService;
import com.bioreagent.vo.LoginVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LoginController {

    @Autowired
    private LoginService loginService;

    @PostMapping("/login")
    public Result<LoginVO> login(@RequestBody LoginDTO loginDTO) {
        return loginService.login(loginDTO.getUsername(), loginDTO.getPassword());
    }

}
