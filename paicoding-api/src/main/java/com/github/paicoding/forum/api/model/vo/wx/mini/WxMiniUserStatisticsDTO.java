package com.github.paicoding.forum.api.model.vo.wx.mini;

import lombok.Data;
import lombok.experimental.Accessors;

import java.io.Serializable;

/**
 * 微信小程序个人中心统计信息。
 */
@Data
@Accessors(chain = true)
public class WxMiniUserStatisticsDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    private Integer joinDayCount = 0;
    private Integer followCount = 0;
    private Integer fansCount = 0;
    private Integer articleCount = 0;
    private Integer praiseCount = 0;
    private Integer readCount = 0;
    private Integer collectionCount = 0;
}
