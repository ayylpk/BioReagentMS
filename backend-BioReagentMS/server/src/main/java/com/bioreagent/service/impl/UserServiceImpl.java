package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.UserQueryParam;
import com.bioreagent.dto.UserDTO;
import com.bioreagent.entity.User;
import com.bioreagent.mapper.UserMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.UserService;
import com.bioreagent.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class UserServiceImpl implements UserService {
    @Autowired
    private UserMapper userMapper;

    @Override
    public PageResult<UserVO> page(UserQueryParam userQueryParam) {
        PageHelper.startPage(userQueryParam.getPage(), userQueryParam.getPageSize());

        List<User> list = userMapper.list(userQueryParam);
        Page<User> p = (Page<User>) list;

        List<UserVO> voList = p.getResult().stream().map(this::toVO).collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Cacheable(value = "user", key = "#id")
    @Override
    public UserVO getById(Integer id) {
        User user = userMapper.getById(id);
        return toVO(user);
    }

    @CacheEvict(value = "user", key = "#userDTO.id")
    @Override
    public void update(UserDTO userDTO) {
        User user = new User();
        BeanUtils.copyProperties(userDTO, user);
        userMapper.update(user);
    }

    @CacheEvict(value = "user", key = "#id")
    @Override
    public void delete(Integer id) {
        userMapper.delete(id);
    }

    @CacheEvict(value = "user", allEntries = true)
    @Override
    public void add(UserDTO userDTO) {
        User user = new User();
        BeanUtils.copyProperties(userDTO, user);
        userMapper.add(user);
    }

    /**
     * Entity → VO 转换
     */
    private UserVO toVO(User user) {
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo);
        return vo;
    }
}
