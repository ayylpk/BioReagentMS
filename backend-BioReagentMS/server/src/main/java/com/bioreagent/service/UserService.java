package com.bioreagent.service;

import com.bioreagent.QueryParam.UserQueryParam;
import com.bioreagent.dto.UserDTO;
import com.bioreagent.result.PageResult;
import com.bioreagent.vo.UserVO;

public interface UserService {
    PageResult<UserVO> page(UserQueryParam userQueryParam);

    UserVO getById(Integer id);

    void update(UserDTO userDTO);

    void delete(Integer id);

    void add(UserDTO userDTO);
}
