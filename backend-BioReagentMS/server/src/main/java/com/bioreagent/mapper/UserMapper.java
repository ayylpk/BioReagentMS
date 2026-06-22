package com.bioreagent.mapper;

import com.bioreagent.QueryParam.UserQueryParam;
import com.bioreagent.entity.User;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface UserMapper {

    /**
     * 根据条件查询用户列表
     */
    List<User> list(UserQueryParam userQueryParam);

    @Select("select * from user where id = #{id}")
    User getById(Integer id);

    /**
     * 动态更新用户信息
     */
    void update(User user);

    @Delete("delete from user where id = #{id}")
    void delete(Integer id);

    @Insert("insert into user(username,password,role,role_name,name,email,phone,status,create_time) " +
            "values(#{username},#{password},#{role},#{roleName},#{name},#{email},#{phone},#{status},#{createTime})")
    void add(User user);

    @Select("select * from user where username = #{username}")
    User getByUsername(String username);
}
