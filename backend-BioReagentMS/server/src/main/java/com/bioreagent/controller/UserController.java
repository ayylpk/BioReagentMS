package com.bioreagent.controller;

import com.bioreagent.QueryParam.UserQueryParam;
import com.bioreagent.annotation.RequirePermission;
import com.bioreagent.dto.UserDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.result.Result;
import com.bioreagent.service.UserService;
import com.bioreagent.vo.UserVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/users/")
@Slf4j
public class UserController {

    @Autowired
    private UserService userService;

    @RequirePermission("user:query")
    @GetMapping
    public Result<PageResult<UserVO>> Page(UserQueryParam userQueryParam){
        PageResult<UserVO> pageResult = userService.page(userQueryParam);
        log.info("分页查询用户信息：{}", userQueryParam);

        return Result.success(pageResult);
    }

    @RequirePermission("user:query")
    @GetMapping("{id}")
    public Result<UserVO> getById(@PathVariable Integer id){
        log.info("查询用户信息：{}", id);
        UserVO user = userService.getById(id);
        return Result.success(user);
    }

    @RequirePermission("user:manage")
    @PutMapping
    public Result update(@RequestBody UserDTO userDTO){
        log.info("更新用户信息：{}", userDTO);
        userService.update(userDTO);
        return Result.success();
    }

    @RequirePermission("user:manage")
    @DeleteMapping
    public Result delete(@RequestParam Integer id){
        log.info("删除用户信息：{}", id);
        userService.delete(id);
        return Result.success();
    }

    @RequirePermission("user:manage")
    @PostMapping
    public Result add(@RequestBody UserDTO userDTO){
        log.info("添加用户信息：{}", userDTO);
        userService.add(userDTO);
        return Result.success();
    }
}
