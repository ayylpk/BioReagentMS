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
import com.bioreagent.utils.PasswordUtil;
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
        // 口令以散列落库；前端没传新口令时保持原值（update 的 XML 是动态 SQL，null/空会被跳过）
        if (user.getPassword() != null && !user.getPassword().isEmpty()) {
            user.setPassword(PasswordUtil.hash(user.getPassword()));
        } else {
            user.setPassword(null);
        }
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
        // 口令一律以散列形态落库（明文存储 = 拖库即全站口令泄露，且用户常在别处复用同一口令）
        user.setPassword(PasswordUtil.hash(user.getPassword()));
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
