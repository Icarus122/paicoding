package com.github.paicoding.forum.api.model.vo.wx.mini;

import lombok.Data;

import java.io.Serializable;

/**
 * 微信小程序作者关注请求。
 */
@Data
public class WxMiniFollowReq implements Serializable {
    private static final long serialVersionUID = 637402924181483112L;

    private Boolean followed;
}
