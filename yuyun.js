/*
cron: "0 8,19 * * *"
new Env("雨云签到")
-------------------  青龙-配置文件-复制区域  -------------------
# 雨云 手机号&密码
# export yuyun="手机号1#密码1"
# 多账号用 换行 分割
*/

const CodeName = "雨云签到"
const env = "yuyun"
const path = require("path")
const fs = require("fs")
const axios = require("axios")

let sendLog = []
const mode = 1 // 并发-2   顺序-1
const runMax = 3 // 最大并发数量
let envSplit = ["\n"]
const ckFile = `${env}.txt`
require("dotenv").config()
//====================================================================================================
// 快速测试ck (填写后会忽略环境变量)
const ck_ = ""
//====================================================================================================

// --- 辅助函数 ---
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

class User {
    constructor(str, id) {
        this.index = id
        this.ck_ = str.split("#")
        this.username = this.ck_[0]
        this.password = this.ck_[1]
        this.remark =
            this.username.substring(0, 3) + "****" + this.username.substring(7)

        // API 相关的状态
        this.csrfToken = null
        this.cookie = null
        this.api = axios.create({
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
            },
        })
    }

    // --- 以下为核心任务逻辑 ---

    async userTask() {
        this.log(`任务开始`)
        const loginSuccess = await this.login(this.username, this.password)
        if (!loginSuccess) {
            this.log(`登录失败`, 1)
            return
        }
        this.log(`登录成功`)

        const delay = getRandomInt(10, 20) // 随机延迟，避免检测
        this.log(`随机延迟 ${delay} 秒...`)
        await sleep(delay * 1000)

        const { ticket, randstr } = await this.getSlideVerify()
        if (!ticket) {
            this.log(`获取验证码失败`, 1)
            return
        }
        this.log(`获取验证码成功`)

        const userInfo = await this.getUserInfo()
        if (!userInfo) {
            this.log(`获取用户信息失败`, 1)
            return
        }

        let { success, message: signMessage } = await this.signIn(ticket, randstr)
        if (success) {
            signMessage = "签到成功"
        }

        // 签到后再次获取用户信息以更新积分
        const newUserInfo = await this.getUserInfo()
        const finalPoints = newUserInfo ? newUserInfo.points : userInfo.points

        const summary = `
      > **签到状态**: ${signMessage}
      > **剩余积分**: ${finalPoints}
      > **最后登录**: ${userInfo.lastIP} (${userInfo.lastLoginArea})
    `.replace(/  +/g, "") // 移除多余的空格
        this.log(summary, 1)
    }

    // --- 以下为 API 请求方法 ---

    async getSlideVerify() {
        for (let i = 0; i < 3; i++) {
            try {
                const response = await this.api.get(
                    "https://txdx.vvvcx.me/solve_captcha?aid=2039519451&type=1",
                    {
                        headers: { "Content-Type": "application/json" },
                    }
                )
                const result = response.data
                if (result.code === 200 && result.message === "Success") {
                    const v = result.data
                    if (v && v.ticket && v.randstr) {
                        return { ticket: v.ticket, randstr: v.randstr }
                    }
                }
            } catch (e) {
                this.log(`第 ${i + 1} 次验证码获取失败: ${e.message}`)
            }
            if (i < 2) {
                await sleep(2000)
            }
        }
        return { ticket: null, randstr: null }
    }

    async login(username, password) {
        try {
            const response = await this.api.post(
                "https://api.v2.rainyun.com/user/login",
                {
                    field: username,
                    password: password,
                },
                {
                    headers: { "Content-Type": "application/json" },
                }
            )

            const cookies = response.headers["set-cookie"]
            if (cookies) {
                this.cookie = cookies.join("; ")
                const tokenCookie = cookies.find((c) => c.startsWith("X-CSRF-Token="))
                if (tokenCookie) {
                    this.csrfToken = tokenCookie.split(";")[0].split("=")[1]
                    return true
                }
            }
            return false
        } catch (error) {
            this.log(`登录请求异常: ${error.message}`)
            return false
        }
    }

    async getUserInfo() {
        if (!this.csrfToken) return null
        try {
            const response = await this.api.get(
                "https://api.v2.rainyun.com/user/?no_cache=false",
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-csrf-token": this.csrfToken,
                        Cookie: this.cookie,
                    },
                }
            )
            const d = response.data.data
            return {
                name: d.Name,
                email: d.Email,
                points: d.Points,
                lastIP: d.LastIP,
                lastLoginArea: d.LastLoginArea,
            }
        } catch (error) {
            this.log(`获取用户信息失败: ${error.message}`)
            return null
        }
    }

    async signIn(ticket, randstr) {
        if (!this.csrfToken) {
            return { success: false, message: "未获取到 csrf_token" }
        }

        // 我们将请求逻辑放在 try...catch 中，以防网络中断等非 HTTP 错误
        try {
            const response = await this.api.post(
                "https://api.v2.rainyun.com/user/reward/tasks",
                {
                    task_name: "每日签到",
                    verifyCode: "",
                    vticket: ticket,
                    vrandstr: randstr,
                },
                {
                    headers: {
                        "x-csrf-token": this.csrfToken,
                        "Cookie": this.cookie,
                    },
                    // --- 关键修改在这里 ---
                    // 自定义 validateStatus，让所有状态码都通过，不抛出异常
                    validateStatus: function (status) {
                        return true // 无论是什么状态码，都认为是成功的响应
                    },
                }
            )

            // --- 现在，无论状态码是 200 还是 400，代码都会执行到这里 ---
            const ret = response.data
            const status = response.status

            // this.log(`签到接口返回状态码: ${status}`);
            // this.log(`签到接口返回数据: ${JSON.stringify(ret)}`);

            // 我们需要自己判断业务逻辑是否成功
            // 雨云API的成功码是 200
            if (ret.code === 200) {
                return { success: true, message: ret.message || "签到成功" }
            } else {
                // 对于其他业务码（如 400 对应的验证码错误），我们返回失败
                return { success: false, message: ret.message || `业务错误码: ${ret.code}` }
            }

        } catch (e) {
            // 这个 catch 现在只会捕获网络错误、超时等问题，而不会捕获 HTTP 状态码错误
            this.log(`签到请求发生网络或未知错误: ${e.message}`)
            return { success: false, message: e.message }
        }
    }


    log(message, pushCode = 0) {
        if (typeof message === "object") {
            message = JSON.stringify(message, null, 2)
        }
        console.log(`${this.index}-${this.remark}, ${message}`)
        if (pushCode) {
            sendLog.push(`\n**${this.remark}**${message}`)
        }
    }
}

// --- 以下为模板自带的执行和通知逻辑，无需修改 ---

class UserList {
    constructor(env) {
        this.env = env
        this.userList = []
        this.logPrefix = `\n[环境检测 ${this.env}]`
        this.mode = mode
    }

    checkEnv() {
        try {
            let UserData = ""
            if (ckFile !== "" && fs.existsSync(ckFile)) {
                UserData = UserData.concat(
                    fs.readFileSync(`./${ckFile}`, "utf-8").split("\n") || []
                )
                console.log(`ck文件[ ${ckFile} ]加载成功`)
            } else {
                console.log(`ck文件[ ${ckFile} ]不存在, 调用青龙环境变量`)
                UserData = process.env[env] || ck_
            }
            if (!UserData || UserData.trim() === "") {
                console.log(`${this.logPrefix} 没有找到账号信息`)
                return false
            }
            this.userList = UserData.split(new RegExp(envSplit.join("|")))
                .filter((cookie) => cookie.trim() !== "")
                .map((cookie, index) => new User(cookie.trim(), `账号[${index + 1}]`))
            const userCount = this.userList.length
            console.log(
                `${this.logPrefix} ${userCount > 0 ? `找到 ${userCount} 个账号\n` : "没有找到账号\n"
                }`
            )
            return true
        } catch (e) {
            console.log(e)
        }
    }

    async runTask() {
        if (!this.checkEnv()) {
            return
        }
        console.log(`🚀 [任务 ${CodeName}] 开始运行`)
        if (this.mode === 2) {
            const taskQueue = []
            const concurrency = runMax
            for (const user of this.userList) {
                while (taskQueue.length >= concurrency) {
                    await Promise.race(taskQueue)
                }
                const promise = user.userTask()
                taskQueue.push(promise)
                promise.finally(() => {
                    taskQueue.splice(taskQueue.indexOf(promise), 1)
                })
                if (taskQueue.length < concurrency) {
                    continue
                }
                await Promise.race(taskQueue)
            }
            await Promise.allSettled(taskQueue)
        } else {
            for (const user of this.userList) {
                await user.userTask()
            }
        }
    }
}

(async () => {
    const s = Date.now()
    const userList = new UserList(env)
    await userList.runTask()
    const e = Date.now()
    await done(s, e)
})().catch(console.error)

async function done(s, e) {
    const el = (e - s) / 1000
    console.log(`\n[任务执行完毕 ${CodeName}] 耗时：${el.toFixed(2)}秒`)
    await showmsg()

    async function showmsg() {
        if (!sendLog) return
        if (!sendLog.length) return
        try {
            const notify = require("./sendNotify")
            await notify.sendNotify(CodeName, sendLog.join("\n"))
        } catch (e) {
            console.error("加载通知服务失败:", e.message)
            console.log(
                "------------------ 推送消息 ------------------\n",
                sendLog.join("\n")
            )
        }
    }

    process.exit(0)
}