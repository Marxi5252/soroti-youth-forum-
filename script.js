// 1. MODULE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  push, 
  onValue, 
  off,
  query,
  limitToLast,
  update, 
  remove, 
  set, 
  get,
  onDisconnect,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. FIREBASE CONFIG & INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyA0BCPLt-9TvXtmPLCRq6Y45AijoUnkB48", 
  authDomain: "soroti-youth-forum.firebaseapp.com",
  projectId: "soroti-youth-forum",
  storageBucket: "soroti-youth-forum.firebasestorage.app",
  messagingSenderId: "1005832853294",
  appId: "1:1005832853294:web:bf61ea5749abf833688cbf",
  measurementId: "G-CHRVZQV6H6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

// 3. GLOBAL STATE
let postsList = [];
let usersList = [];
let friendsList = [];
let pendingRequests = [];
let sentRequests = [];
let currentUser = null;

let activeChatRoom = null;
let activeChatRef = null;
let activeChatCallback = null;

let notifRef = null;
let notifCallback = null;
let friendsRef = null;
let friendsCallback = null;
let requestsRef = null;
let requestsCallback = null;
let sentRequestsRef = null;
let sentRequestsCallback = null;
let connectedRef = null;
let connectedCallback = null;

let currentPostFile = null;
let currentChatFile = null;
let uploadedAvatarFile = null;

// 4. HELPER FUNCTIONS
async function compressImage(file, maxWidth = 1000, quality = 0.75) {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now()
          }));
        }, file.type, quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function uploadMediaFile(file, folderPath) {
  if (!file) return null;

  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB Limit
  if (file.size > MAX_SIZE_BYTES) {
    showToast("File size exceeds 5MB upload limit.");
    return null;
  }

  try {
    const fileToUpload = file.type.startsWith('image/') ? await compressImage(file) : file;
    const uniqueFileName = `${crypto.randomUUID()}_${fileToUpload.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fileReference = storageRef(storage, `${folderPath}/${uniqueFileName}`);
    await uploadBytes(fileReference, fileToUpload);
    return await getDownloadURL(fileReference);
  } catch (error) {
    console.warn("Storage upload warning:", error);
    showToast("Cloud Storage upload failed.");
    return null;
  }
}

function getInitials(name) {
  return name ? name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2) : 'SY';
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

export async function sendNotification(targetUid, title, message, icon = 'fa-bell') {
  if (!targetUid) return;
  try {
    const targetNotifRef = ref(database, `notifications/${targetUid}`);
    await push(targetNotifRef, {
      title: title,
      message: message,
      icon: icon,
      read: false,
      createdAt: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    triggerDesktopPush(title, message);
  } catch (err) {
    console.warn("Could not dispatch notification:", err);
  }
}

function triggerDesktopPush(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "logo.png" });
  }
}

function showToast(message) {
  const toastNotice = document.getElementById('toastNotice');
  if (!toastNotice) return;
  toastNotice.querySelector('span').innerHTML = message;
  toastNotice.style.display = 'flex';
  setTimeout(() => { toastNotice.style.display = 'none'; }, 4000);
}

function setupPresenceSystem(user) {
  if (!user) return;
  
  if (connectedRef && connectedCallback) {
    off(connectedRef, 'value', connectedCallback);
  }

  connectedRef = ref(database, ".info/connected");
  const userStatusRef = ref(database, `users/${user.uid}/isOnline`);
  const userLastSeenRef = ref(database, `users/${user.uid}/lastSeen`);

  connectedCallback = (snapshot) => {
    if (snapshot.val() === false) return;
    onDisconnect(userStatusRef).set(false).then(() => {
      onDisconnect(userLastSeenRef).set(serverTimestamp());
      set(userStatusRef, true);
      set(userLastSeenRef, serverTimestamp());
    });
  };

  onValue(connectedRef, connectedCallback);
}

function detachUserListeners() {
  if (notifRef && notifCallback) off(notifRef, 'value', notifCallback);
  if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
  if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
  if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
  if (connectedRef && connectedCallback) off(connectedRef, 'value', connectedCallback);
  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);

  notifRef = null; notifCallback = null;
  friendsRef = null; friendsCallback = null;
  requestsRef = null; requestsCallback = null;
  sentRequestsRef = null; sentRequestsCallback = null;
  connectedRef = null; connectedCallback = null;
  activeChatRef = null; activeChatCallback = null;
}

function closeDrawer() {
  const navDrawer = document.getElementById('navDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  if (navDrawer) navDrawer.classList.remove('open');
  if (drawerOverlay) drawerOverlay.classList.remove('active');
}

// 5. GLOBAL INTERACTIVE WINDOW FUNCTIONS
window.sendFriendRequest = async function(targetUid) {
  if (!currentUser) return;
  try {
    await set(ref(database, `friendRequests/${targetUid}/${currentUser.uid}`), {
      fromName: currentUser.name,
      timestamp: Date.now()
    });
    await set(ref(database, `sentRequests/${currentUser.uid}/${targetUid}`), true);
    sendNotification(targetUid, currentUser.name, 'sent you a friend request.', 'fa-user-plus');
    showToast('Friend request sent!');
  } catch (err) {
    console.error("Failed to send friend request:", err);
  }
};

window.acceptFriendRequest = async function(senderUid, senderName) {
  if (!currentUser) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${senderUid}`] = true;
    updates[`friends/${senderUid}/${currentUser.uid}`] = true;
    updates[`friendRequests/${currentUser.uid}/${senderUid}`] = null;
    updates[`sentRequests/${senderUid}/${currentUser.uid}`] = null;
    
    await update(ref(database), updates);
    sendNotification(senderUid, currentUser.name, 'accepted your friend request.', 'fa-user-check');
    showToast(`You are now friends with ${senderName}`);
  } catch (err) {
    console.error("Failed to accept request:", err);
  }
};

window.removeFriend = async function(friendUid) {
  if (!currentUser || !confirm('Are you sure you want to remove this friend?')) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${friendUid}`] = null;
    updates[`friends/${friendUid}/${currentUser.uid}`] = null;
    await update(ref(database), updates);
    showToast('Friend removed.');
  } catch (err) {
    console.error("Failed to remove friend:", err);
  }
};

window.toggleLike = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
      const likeSnap = await get(likeRef);

      if (likeSnap.exists()) {
        await remove(likeRef);
      } else {
        await set(likeRef, true);
        if (post.uid && post.uid !== currentUser.uid) {
          sendNotification(post.uid, currentUser.name, 'liked your post.', 'fa-heart');
        }
      }
    }
  } catch (err) {
    console.error("Failed to toggle like:", err);
  }
};

window.toggleDislike = async function(id) {
  if (!currentUser) return;
  try {
    const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
    const snapshot = await get(dislikeRef);
    if (snapshot.exists()) {
      await remove(dislikeRef);
    } else {
      await set(dislikeRef, true);
    }
  } catch (err) {
    console.error("Failed to toggle dislike:", err);
  }
};

window.toggleCommentSection = function(id) {
  const section = document.getElementById(`commentSection-${id}`);
  if (section) section.classList.toggle('hidden');
};

window.addComment = async function(id) {
  const input = document.getElementById(`commentInput-${id}`);
  if (!input || !input.value.trim()) return;

  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const commentsRef = ref(database, `posts/${id}/comments`);
      
      await push(commentsRef, {
        author: currentUser ? currentUser.name : 'Anonymous',
        text: input.value.trim(),
        createdAt: Date.now()
      });

      if (post.uid && currentUser && post.uid !== currentUser.uid) {
        sendNotification(post.uid, currentUser.name, 'commented on your post.', 'fa-comment');
      }
    }
    input.value = '';
  } catch (err) {
    console.error("Failed to add comment:", err);
  }
};

// FEATURE ENHANCEMENT 1: EDIT POST
window.toggleEditPost = function(id) {
  const displayEl = document.getElementById(`postContent-${id}`);
  const editContainer = document.getElementById(`editPostContainer-${id}`);
  if (displayEl && editContainer) {
    displayEl.classList.toggle('hidden');
    editContainer.classList.toggle('hidden');
  }
};

window.saveEditPost = async function(id) {
  const textarea = document.getElementById(`editPostInput-${id}`);
  if (!textarea) return;
  const newContent = textarea.value.trim();
  if (!newContent) {
    showToast("Post content cannot be empty.");
    return;
  }

  try {
    await update(ref(database, `posts/${id}`), {
      content: newContent,
      editedAt: Date.now(),
      isEdited: true
    });
    showToast("Post updated successfully!");
  } catch (err) {
    console.error("Failed to update post:", err);
    showToast("Failed to save changes.");
  }
};

window.deletePost = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);
    if (snapshot.exists()) {
      const post = snapshot.val();
      if (post.uid === currentUser.uid || post.authorEmail === currentUser.email) {
        if (confirm('Are you sure you want to delete this post?')) {
          await remove(postRef);
          showToast('Post deleted successfully.');
        }
      } else {
        showToast('Unauthorized: You can only delete your own posts.');
      }
    }
  } catch (err) {
    console.error("Failed to delete post:", err);
  }
};

window.openChat = function(recipientUid, recipientName) {
  if (!currentUser) {
    showToast('Please log in to chat.');
    return;
  }

  const chatPopup = document.getElementById('chatPopup');
  const chatFriendName = document.getElementById('chatFriendName');
  const chatMessages = document.getElementById('chatMessages');
  if (!chatPopup) return;

  chatFriendName.textContent = `Chat with ${recipientName || 'User'}`;
  chatPopup.classList.remove('hidden');

  const roomPath = recipientUid ? [currentUser.uid, recipientUid].sort().join('_') : 'global_room';
  activeChatRoom = `direct_${roomPath}`;

  if (activeChatRef && activeChatCallback) {
    off(activeChatRef, 'value', activeChatCallback);
  }

  chatMessages.innerHTML = `<div class="chat-msg system">Connecting to conversation...</div>`;

  activeChatRef = ref(database, `chats/${activeChatRoom}`);
  activeChatCallback = (snapshot) => {
    const data = snapshot.val();
    chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(recipientName || 'Group')}</div>`;
    if (data) {
      Object.values(data).forEach(msg => {
        const msgEl = document.createElement('div');
        const isMe = msg.senderUid === currentUser.uid;
        msgEl.className = isMe ? 'chat-msg outgoing' : 'chat-msg incoming';
        
        let html = `<div>${escapeHTML(msg.text || '')}</div>`;
        if (msg.attachment) {
          html += `<div style="margin-top: 5px;"><img src="${escapeHTML(msg.attachment)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; display: block;" /></div>`;
        }
        msgEl.innerHTML = html;
        chatMessages.appendChild(msgEl);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  };

  onValue(activeChatRef, activeChatCallback);
};

window.openChatFromTab = function(friendUid, friendName) {
  window.openChat(friendUid, friendName);
};

// 6. INITIALIZATION & CONTROLLERS
document.addEventListener('DOMContentLoaded', () => {

  const themeToggleBtns = document.querySelectorAll('.themeToggleBtn');
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.body.classList.add('dark-theme');
    themeToggleBtns.forEach(btn => btn.innerHTML = '<i class="fa-solid fa-sun"></i> Light Mode');
  }

  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggleBtns.forEach(b => {
        b.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
      });
    });
  });

  let isSignUpMode = false;

  const elements = {
    authScreen: document.getElementById('authScreen'),
    appContent: document.getElementById('appContent'),
    authPageForm: document.getElementById('authPageForm'),
    tabLoginBtn: document.getElementById('tabLoginBtn'),
    tabSignupBtn: document.getElementById('tabSignupBtn'),
    fullNameGroup: document.getElementById('fullNameGroup'),
    pageAuthName: document.getElementById('pageAuthName'),
    pageAuthEmail: document.getElementById('pageAuthEmail'),
    pageAuthPassword: document.getElementById('pageAuthPassword'),
    pageAuthSubmitBtn: document.getElementById('pageAuthSubmitBtn'),
    authErrorMsg: document.getElementById('authErrorMsg'),
    forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),

    navDrawer: document.getElementById('navDrawer'),
    drawerOverlay: document.getElementById('drawerOverlay'),
    navBtns: document.querySelectorAll('.nav-btn'),
    drawerCloseBtn: document.getElementById('drawerCloseBtn'),
    
    profileNames: document.querySelectorAll('.profile-name'),
    profileEmails: document.querySelectorAll('.profile-email'),
    profileAvatars: document.querySelectorAll('.profile-avatar'),
    
    logoutBtns: document.querySelectorAll('.logout-btn'),
    signupBtn: document.querySelector('.signup-btn'),
    searchInput: document.getElementById('searchInput'),
    searchActionBtn: document.getElementById('searchActionBtn'),

    postText: document.getElementById('postText'),
    postPhotoInput: document.getElementById('postPhotoInput'),
    postFileInput: document.getElementById('postFileInput'),
    postBtn: document.getElementById('createPostSubmitBtn'),
    postBox: document.getElementById('postBox'),
    feedContainer: document.getElementById('feedContainer'),
    fabBtn: document.getElementById('fabBtn'),
    backToTopBtn: document.getElementById('backToTopBtn'),
    toastNotice: document.getElementById('toastNotice'),
    toastClose: document.getElementById('toastCloseBtn'),

    chatPopup: document.getElementById('chatPopup'),
    chatFriendName: document.getElementById('chatFriendName'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatFileInput: document.getElementById('chatFileInput'),
    chatSendBtn: document.getElementById('chatSendBtn'),
    chatCloseBtn: document.getElementById('chatCloseBtn'),
    
    callBtn: document.querySelector('.call-btn'),
    videoBtn: document.querySelector('.video-btn'),

    tabBtns: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
  };

  function init() {
    setupPreviewContainers();
    bindEvents();
    listenToAuthState();
    listenToPosts();
    listenToUsers();
    switchTab('posts');
  }

  function listenToAuthState() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        let userData = {};
        try {
          const userSnapshot = await get(ref(database, `users/${user.uid}`));
          if (userSnapshot.exists()) {
            userData = userSnapshot.val();
          }
        } catch (err) {
          console.warn("Could not load user profile data from Realtime Database:", err);
        }

        currentUser = {
          uid: user.uid,
          name: userData.displayName || user.displayName || user.email.split('@')[0],
          email: user.email,
          avatarUrl: userData.avatarUrl || user.photoURL || null
        };
        
        setupPresenceSystem(user);
        updateAuthView(true);
        listenToNotifications();
        listenToUserSocialData();
      } else {
        currentUser = null;
        detachUserListeners();
        updateAuthView(false);
      }
    });
  }

  function listenToUserSocialData() {
    if (!currentUser) return;

    if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
    friendsRef = ref(database, `friends/${currentUser.uid}`);
    friendsCallback = (snap) => {
      friendsList = snap.exists() ? Object.keys(snap.val()) : [];
      renderUsersList();
    };
    onValue(friendsRef, friendsCallback);

    if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
    requestsRef = ref(database, `friendRequests/${currentUser.uid}`);
    requestsCallback = (snap) => {
      pendingRequests = [];
      if (snap.exists()) {
        Object.keys(snap.val()).forEach(uid => {
          pendingRequests.push({ uid, ...snap.val()[uid] });
        });
      }
      renderUsersList();
    };
    onValue(requestsRef, requestsCallback);

    if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
    sentRequestsRef = ref(database, `sentRequests/${currentUser.uid}`);
    sentRequestsCallback = (snap) => {
      sentRequests = snap.exists() ? Object.keys(snap.val()) : [];
      renderUsersList();
    };
    onValue(sentRequestsRef, sentRequestsCallback);
  }

  function listenToUsers() {
    const usersQuery = query(ref(database, 'users'), limitToLast(100));

    onValue(usersQuery, (snapshot) => {
      const data = snapshot.val();
      usersList = [];
      if (data) {
        Object.keys(data).forEach(uid => {
          usersList.push({ uid, ...data[uid] });
        });
      }
      renderUsersList();
    });
  }

  function renderUsersList() {
    const chatsContainer = document.getElementById('chatsListContainer');
    const findFriendsContainer = document.getElementById('friendsListContainer');
    const sidebarContainer = document.getElementById('sidebarMembersContainer');

    const otherMembers = usersList.filter(u => !currentUser || u.uid !== currentUser.uid);
    const addedFriends = otherMembers.filter(u => friendsList.includes(u.uid));

    if (chatsContainer) {
      chatsContainer.innerHTML = otherMembers.length === 0 ? '<p style="color:#888; font-size:13px; padding:10px;">No members registered yet.</p>' : otherMembers.map(u => `
        <div class="friend-item" style="cursor: pointer; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05);" onclick="openChatFromTab('${u.uid}', '${escapeHTML(u.displayName || 'Member')}')">
          <div class="friend-user">
            <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
              <div class="avatar">${getInitials(u.displayName)}</div>
              <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
            </div>
            <div>
              <strong style="font-size: 14px; display: block;">${escapeHTML(u.displayName || 'Member')}</strong>
              <span style="font-size: 12px; opacity: 0.7;">Click to message</span>
            </div>
          </div>
          <button class="chat-btn"><i class="fa-solid fa-comment"></i> Chat</button>
        </div>
      `).join('');
    }

    if (findFriendsContainer) {
      let html = '';

      if (pendingRequests.length > 0) {
        html += `<h4 style="margin: 10px 0 5px; font-size: 13px; color: var(--color-red);">Pending Requests</h4>`;
        html += pendingRequests.map(req => `
          <div class="friend-item" style="margin-bottom: 10px; padding: 8px; background: rgba(0,0,0,0.02); border-radius: 6px;">
            <div class="friend-user">
              <div class="avatar">${getInitials(req.fromName)}</div>
              <div><strong>${escapeHTML(req.fromName)}</strong></div>
            </div>
            <button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${req.uid}', '${escapeHTML(req.fromName)}')"><i class="fa-solid fa-user-check"></i> Accept</button>
          </div>
        `).join('');
      }

      html += `<h4 style="margin: 15px 0 5px; font-size: 13px; color: #888;">Find Friends Network</h4>`;
      html += otherMembers.length === 0 ? '<p style="color:#888; font-size:13px; padding:10px;">No other members to display.</p>' : otherMembers.map(u => {
        const isFriend = friendsList.includes(u.uid);
        const isSent = sentRequests.includes(u.uid);

        let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${u.uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
        if (isFriend) {
          actionBtn = `<button class="chat-btn" style="opacity: 0.7;" onclick="removeFriend('${u.uid}')"><i class="fa-solid fa-user-minus"></i> Remove</button>`;
        } else if (isSent) {
          actionBtn = `<button class="chat-btn" disabled style="opacity: 0.5;"><i class="fa-solid fa-clock"></i> Pending</button>`;
        }

        return `
          <div class="friend-item" style="margin-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 8px;">
            <div class="friend-user">
              <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
                <div class="avatar">${getInitials(u.displayName)}</div>
                <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
              </div>
              <div>
                <strong>${escapeHTML(u.displayName || 'Member')}</strong>
                <span style="display: block; font-size: 11px; opacity: 0.6;">${escapeHTML(u.email || 'Soroti Youth Forum')}</span>
              </div>
            </div>
            ${actionBtn}
          </div>
        `;
      }).join('');

      findFriendsContainer.innerHTML = html;
    }

    if (sidebarContainer) {
      sidebarContainer.innerHTML = addedFriends.length === 0 ? '<p style="color:#888; font-size:12px;">No added friends online yet.</p>' : addedFriends.slice(0, 5).map(u => `
        <div class="friend-item">
          <div class="friend-user">
            <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
              <div class="avatar">${getInitials(u.displayName)}</div>
              <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
            </div>
            <span>${escapeHTML(u.displayName || 'Member')}</span>
          </div>
          <button class="chat-btn" onclick="openChatFromTab('${u.uid}', '${escapeHTML(u.displayName || 'Member')}')"><i class="fa-solid fa-comment"></i></button>
        </div>
      `).join('');
    }
  }

  function listenToNotifications() {
    if (!currentUser) return;
    
    if (notifRef && notifCallback) off(notifRef, 'value', notifCallback);

    notifRef = ref(database, `notifications/${currentUser.uid}`);
    notifCallback = (snapshot) => {
      const data = snapshot.val();
      const notifList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          notifList.push({ id: key, ...data[key] });
        });
        notifList.sort((a, b) => b.createdAt - a.createdAt);
      }
      renderNotifications(notifList);
    };

    onValue(notifRef, notifCallback);
  }

  function renderNotifications(notifications) {
    const container = document.getElementById('notificationsContainer');
    const badgeEls = document.querySelectorAll('.notif-badge');
    
    const unreadCount = notifications.filter(n => !n.read).length;
    badgeEls.forEach(b => {
      b.textContent = unreadCount;
      b.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    });

    if (!container) return;

    if (notifications.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">
          No notifications yet. You're all caught up!
        </div>`;
      return;
    }

    container.innerHTML = notifications.map(notif => `
      <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05); ${notif.read ? 'opacity: 0.6;' : 'font-weight: 600;'}">
        <span>
          <i class="fa-solid ${escapeHTML(notif.icon || 'fa-bell')}" style="color: var(--color-red); margin-right: 6px;"></i> 
          <strong>${escapeHTML(notif.title)}</strong> ${escapeHTML(notif.message)}
        </span>
        <span style="font-size: 11px; opacity: 0.5;">${escapeHTML(notif.time || 'Recently')}</span>
      </div>
    `).join('');
  }

  async function markAllNotificationsRead() {
    if (!currentUser) return;
    try {
      const targetNotifRef = ref(database, `notifications/${currentUser.uid}`);
      const snapshot = await get(targetNotifRef);
      if (snapshot.exists()) {
        const updates = {};
        Object.keys(snapshot.val()).forEach(key => {
          updates[`${key}/read`] = true;
        });
        await update(targetNotifRef, updates);
        showToast('All notifications marked as read.');
      }
    } catch (err) {
      console.error("Failed to mark notifications read:", err);
    }
  }

  function listenToPosts() {
    if (elements.feedContainer) {
      elements.feedContainer.innerHTML = '<div class="spinner"></div>';
    }

    const postsQuery = query(ref(database, 'posts'), limitToLast(50));
    
    onValue(postsQuery, (snapshot) => {
      const data = snapshot.val();
      postsList = [];
      if (data) {
        Object.keys(data).forEach((key) => {
          postsList.push({ id: key, ...data[key] });
        });
        postsList.sort((a, b) => b.createdAt - a.createdAt);
      }
      renderFeed(getCurrentSearchQuery());
    }, (error) => {
      console.warn("Realtime database error reading posts:", error);
    });
  }

  // FEATURE ENHANCEMENT 2: RICH MEDIA PREVIEWS (IMAGES, VIDEO, AUDIO)
  function setupPreviewContainers() {
    if (elements.postBox) {
      const previewDiv = document.createElement('div');
      previewDiv.id = 'postPreviewContainer';
      previewDiv.style.cssText = 'margin-top: 10px; display: none; position: relative;';
      previewDiv.innerHTML = `
        <div style="position: relative; display: inline-block; max-width: 100%;">
          <img id="postPreviewImg" src="" style="max-height: 180px; max-width: 100%; border-radius: 8px; border: 1px solid #ddd; display: none;" />
          <video id="postPreviewVid" controls style="max-height: 180px; max-width: 100%; border-radius: 8px; display: none;"></video>
          <audio id="postPreviewAud" controls style="display: none; margin-top: 5px;"></audio>
          <div id="postPreviewFile" style="padding: 8px; background: rgba(0,0,0,0.05); border-radius: 6px; font-size: 12px; display: none;"></div>
          <button id="clearPostPreviewBtn" type="button" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: 11px;"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      const actionsRow = elements.postBox.querySelector('.post-actions-row');
      if (actionsRow) elements.postBox.insertBefore(previewDiv, actionsRow);
    }

    if (elements.chatPopup) {
      const chatPreviewDiv = document.createElement('div');
      chatPreviewDiv.id = 'chatPreviewContainer';
      chatPreviewDiv.style.cssText = 'padding: 5px 10px; background: rgba(0,0,0,0.03); display: none; align-items: center; justify-content: space-between; font-size: 12px; border-top: 1px solid rgba(0,0,0,0.05);';
      chatPreviewDiv.innerHTML = `
        <span id="chatPreviewText" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;"></span>
        <button id="clearChatPreviewBtn" type="button" style="background: none; border: none; color: #888; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      `;
      const chatInputRow = elements.chatPopup.querySelector('.chat-input-row');
      if (chatInputRow) elements.chatPopup.insertBefore(chatPreviewDiv, chatInputRow);
    }
  }

  function getCurrentSearchQuery() {
    return elements.searchInput ? elements.searchInput.value.trim() : '';
  }

  function updateAuthView(isLoggedIn) {
    if (isLoggedIn && currentUser) {
      if (elements.authScreen) elements.authScreen.style.display = 'none';
      if (elements.appContent) {
        elements.appContent.style.display = 'block';
        elements.appContent.classList.remove('hidden');
      }
      if (elements.signupBtn) elements.signupBtn.classList.add('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.remove('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.remove('hidden'));
      updateUserUI();
    } else {
      if (elements.authScreen) elements.authScreen.style.display = 'flex';
      if (elements.appContent) {
        elements.appContent.style.display = 'none';
        elements.appContent.classList.add('hidden');
      }
      if (elements.signupBtn) elements.signupBtn.classList.remove('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.add('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.add('hidden'));
    }
  }

  function setAuthMode(signUp) {
    isSignUpMode = signUp;
    if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';
    
    if (isSignUpMode) {
      elements.tabSignupBtn?.classList.add('active');
      elements.tabLoginBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.remove('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Create Account';
    } else {
      elements.tabLoginBtn?.classList.add('active');
      elements.tabSignupBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.add('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Log In';
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const isSignUp = elements.tabSignupBtn?.classList.contains('active');
    
    const email = elements.pageAuthEmail.value.trim();
    const password = elements.pageAuthPassword.value.trim();
    const name = elements.pageAuthName ? elements.pageAuthName.value.trim() : '';

    if (!email || !password || (isSignUp && !name)) {
      if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Please fill in all required fields.';
      return;
    }

    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await updateProfile(user, { displayName: name });
        try {
          await update(ref(database, `users/${user.uid}`), { displayName: name, email: email, uid: user.uid, isOnline: true });
        } catch (dbErr) {
          console.warn("Database user set warning:", dbErr);
        }
        showToast(`Welcome to Soroti Youth Forum, ${name}!`);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        showToast(`Welcome back!`);
      }
      elements.pageAuthEmail.value = '';
      elements.pageAuthPassword.value = '';
      if (elements.pageAuthName) elements.pageAuthName.value = '';
    } catch (error) {
      if (elements.authErrorMsg) {
        if (error.code === 'auth/invalid-credential') {
          elements.authErrorMsg.textContent = 'Incorrect email or password. If you do not have an account, click Sign Up.';
        } else if (error.code === 'auth/user-not-found') {
          elements.authErrorMsg.textContent = 'No account found with this email. Click Sign Up above to register.';
        } else if (error.code === 'auth/wrong-password') {
          elements.authErrorMsg.textContent = 'Incorrect password.';
        } else {
          elements.authErrorMsg.textContent = error.message.replace('Firebase: ', '');
        }
      }
    }
  }

  async function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
      if (currentUser) {
        await set(ref(database, `users/${currentUser.uid}/isOnline`), false);
        await set(ref(database, `users/${currentUser.uid}/lastSeen`), serverTimestamp());
      }
      detachUserListeners();
      await signOut(auth);
    }
  }

  function updateUserUI() {
    if (!currentUser) return;
    elements.profileNames.forEach(el => el.textContent = currentUser.name);
    elements.profileEmails.forEach(el => el.textContent = currentUser.email);
    
    elements.profileAvatars.forEach(el => {
      if (currentUser.avatarUrl) {
        el.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = 'none';
        el.textContent = getInitials(currentUser.name);
      }
    });

    const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
    if (settingsAvatarPreview) {
      if (currentUser.avatarUrl) {
        settingsAvatarPreview.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
        settingsAvatarPreview.style.backgroundSize = 'cover';
        settingsAvatarPreview.style.backgroundPosition = 'center';
        settingsAvatarPreview.textContent = '';
      } else {
        settingsAvatarPreview.style.backgroundImage = 'none';
        settingsAvatarPreview.textContent = getInitials(currentUser.name);
      }
    }

    const nameInput = document.getElementById('settingsNameInput');
    const emailInput = document.getElementById('settingsEmailInput');
    if (nameInput) nameInput.value = currentUser.name || '';
    if (emailInput) emailInput.value = currentUser.email || '';
  }

  function renderFeed(filterQuery = '') {
    if (!elements.feedContainer) return;

    let displayPosts = postsList;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      displayPosts = postsList.filter(p => (p.content && p.content.toLowerCase().includes(q)) || (p.author && p.author.toLowerCase().includes(q)));
    }

    if (displayPosts.length === 0) {
      elements.feedContainer.innerHTML = `
        <div class="card">
          <div class="animated-stripe-bar"></div>
          <h3>No posts found</h3>
          <p style="color: #888; margin-top: 8px; font-size: 14px;">Try another search term or share an update!</p>
        </div>`;
      return;
    }

    elements.feedContainer.innerHTML = displayPosts.map(post => {
      const isOwner = currentUser && (currentUser.uid === post.uid || currentUser.email === post.authorEmail);
      
      const likesCount = post.likes ? Object.keys(post.likes).length : 0;
      const isLiked = post.likes && currentUser && post.likes[currentUser.uid];

      const dislikesCount = post.dislikes ? Object.keys(post.dislikes).length : 0;
      const isDisliked = post.dislikes && currentUser && post.dislikes[currentUser.uid];

      const commentsArray = post.comments ? Object.values(post.comments) : [];

      let attachmentHTML = '';
      if (post.attachment) {
        const type = post.attachmentType || '';
        if (type === 'image') {
          attachmentHTML = `
            <div class="media-attachment-container">
              <img src="${escapeHTML(post.attachment)}" alt="Attached Photo" style="width: 100%; max-height: 400px; object-fit: contain; display: block;" />
            </div>`;
        } else if (type === 'video') {
          attachmentHTML = `
            <div class="media-attachment-container">
              <video src="${escapeHTML(post.attachment)}" controls style="max-height: 400px; width: 100%;"></video>
            </div>`;
        } else if (type === 'audio') {
          attachmentHTML = `
            <div class="media-attachment-container" style="background: transparent;">
              <audio src="${escapeHTML(post.attachment)}" controls style="width: 100%;"></audio>
            </div>`;
        } else {
          attachmentHTML = `
            <div style="margin-bottom: 12px; font-size: 12px; opacity: 0.8; background: rgba(0,0,0,0.03); padding: 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.05);">
              <i class="fa-solid fa-paperclip"></i> Attached File: <a href="${escapeHTML(post.attachment)}" target="_blank" style="color: inherit; font-weight: bold;">${escapeHTML(post.attachmentName || 'Download Attachment')}</a>
            </div>`;
        }
      }

      return `
        <div class="card post-card" data-id="${post.id}">
          <div class="animated-stripe-bar"></div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div class="friend-user">
              <div class="avatar-wrapper"><div class="avatar">${escapeHTML(post.initials || 'SY')}</div></div>
              <div>
                <strong style="font-size: 14px; display: block;">${escapeHTML(post.author || 'Anonymous')}</strong>
                <span style="font-size: 11px; color: #888;">${escapeHTML(post.time || 'Recently')} ${post.isEdited ? '<i style="font-size:10px;">(edited)</i>' : ''}</span>
              </div>
            </div>
            
            ${isOwner ? `
              <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="toggleEditPost('${post.id}')" style="background: none; border: none; color: var(--text-color); opacity: 0.7; cursor: pointer; font-size: 13px;" title="Edit Post">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="deletePost('${post.id}')" style="background: none; border: none; color: #e50914; cursor: pointer; font-size: 14px;" title="Delete Post">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            ` : ''}
          </div>
          
          ${post.content ? `<p id="postContent-${post.id}" style="font-size: 14px; line-height: 1.5; margin-bottom: 10px;">${escapeHTML(post.content)}</p>` : ''}
          
          <div id="editPostContainer-${post.id}" class="hidden" style="margin-bottom: 12px;">
            <textarea id="editPostInput-${post.id}" style="width: 100%; border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font-size: 13px; background: var(--card-bg); color: var(--text-color); resize: vertical;">${escapeHTML(post.content || '')}</textarea>
            <div style="display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end;">
              <button onclick="toggleEditPost('${post.id}')" style="padding: 4px 10px; background: transparent; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; cursor: pointer; color: var(--text-color);">Cancel</button>
              <button onclick="saveEditPost('${post.id}')" style="padding: 4px 12px; background: var(--color-red); color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer;">Save</button>
            </div>
          </div>

          ${attachmentHTML}
          
          <div style="display: flex; gap: 15px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px; font-size: 13px; align-items: center;">
            <button onclick="toggleLike('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${isLiked ? '#e50914' : 'inherit'};">
              ${isLiked ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>'} ${likesCount}
            </button>
            <button onclick="toggleDislike('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${isDisliked ? '#e50914' : 'inherit'};">
              ${isDisliked ? '<i class="fa-solid fa-thumbs-down"></i>' : '<i class="fa-regular fa-thumbs-down"></i>'} ${dislikesCount}
            </button>
            <button onclick="toggleCommentSection('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: inherit;">
              <i class="fa-solid fa-comment"></i> Comment (${commentsArray.length})
            </button>
          </div>

          <div id="commentSection-${post.id}" class="hidden" style="margin-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 8px;">
            <div style="max-height: 120px; overflow-y: auto; margin-bottom: 8px;">
              ${commentsArray.map(c => `
                <div style="font-size: 12px; background: rgba(0,0,0,0.03); padding: 5px 8px; border-radius: 4px; margin-bottom: 4px;">
                  <strong>${escapeHTML(c.author)}:</strong> ${escapeHTML(c.text)}
                </div>
              `).join('')}
            </div>
            <div style="display: flex; gap: 5px;">
              <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex:1; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px; outline: none; background: transparent; color: var(--text-color);" />
              <button onclick="addComment('${post.id}')" style="padding: 6px 10px; background: var(--color-black); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
          </div>

        </div>
      `;
    }).join('');
  }

  async function handleCreatePost() {
    const content = elements.postText ? elements.postText.value.trim() : '';
    if (!content && !currentPostFile) return;

    if (elements.postBtn) {
      elements.postBtn.disabled = true;
      elements.postBtn.textContent = 'Posting...';
    }

    let attachmentUrl = null;
    let attachmentType = null;

    if (currentPostFile) {
      showToast('Uploading attachment...');
      attachmentUrl = await uploadMediaFile(currentPostFile, 'post_attachments');
      if (currentPostFile.type.startsWith('image/')) attachmentType = 'image';
      else if (currentPostFile.type.startsWith('video/')) attachmentType = 'video';
      else if (currentPostFile.type.startsWith('audio/')) attachmentType = 'audio';
      else attachmentType = 'file';
    }

    const newPost = {
      uid: currentUser ? currentUser.uid : null,
      author: currentUser ? currentUser.name : 'Anonymous',
      authorEmail: currentUser ? currentUser.email : null,
      initials: getInitials(currentUser ? currentUser.name : 'AN'),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: Date.now(),
      content: content,
      attachment: attachmentUrl,
      attachmentType: attachmentType,
      attachmentName: currentPostFile ? currentPostFile.name : null,
      likes: {},
      dislikes: {},
      comments: {}
    };

    try {
      await push(ref(database, 'posts'), newPost);
      if (elements.postText) elements.postText.value = '';
      clearPostPreview();
      showToast('Post published successfully!');
    } catch (err) {
      console.error("Failed to create post:", err);
      showToast('Failed to create post. Please try again.');
    } finally {
      if (elements.postBtn) {
        elements.postBtn.disabled = false;
        elements.postBtn.textContent = 'Post';
      }
    }
  }

  function clearPostPreview() {
    currentPostFile = null;
    if (elements.postPhotoInput) elements.postPhotoInput.value = '';
    if (elements.postFileInput) elements.postFileInput.value = '';
    
    const container = document.getElementById('postPreviewContainer');
    const img = document.getElementById('postPreviewImg');
    const vid = document.getElementById('postPreviewVid');
    const aud = document.getElementById('postPreviewAud');
    const fileTxt = document.getElementById('postPreviewFile');
    
    if (container) container.style.display = 'none';
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (vid) { vid.src = ''; vid.style.display = 'none'; }
    if (aud) { aud.src = ''; aud.style.display = 'none'; }
    if (fileTxt) { fileTxt.textContent = ''; fileTxt.style.display = 'none'; }
  }

  function clearChatPreview() {
    currentChatFile = null;
    const container = document.getElementById('chatPreviewContainer');
    if (container) container.style.display = 'none';
    if (elements.chatFileInput) elements.chatFileInput.value = '';
  }

  async function sendChatMessage() {
    const text = elements.chatInput.value.trim();
    if ((!text && !currentChatFile) || !activeChatRoom) return;

    let attachmentUrl = null;
    if (currentChatFile) {
      attachmentUrl = await uploadMediaFile(currentChatFile, 'chat_attachments');
    }

    try {
      await push(ref(database, `chats/${activeChatRoom}`), {
        senderUid: currentUser ? currentUser.uid : 'anon',
        senderName: currentUser ? currentUser.name : 'Anonymous',
        text: text,
        attachment: attachmentUrl,
        timestamp: Date.now()
      });

      elements.chatInput.value = '';
      clearChatPreview();
    } catch (err) {
      console.error("Failed to send chat message:", err);
    }
  }

  function switchTab(targetTab) {
    closeDrawer();

    elements.tabViews.forEach(view => view.classList.add('hidden'));
    const activeView = document.getElementById(`${targetTab}View`);
    if (activeView) activeView.classList.remove('hidden');

    elements.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
    });

    document.querySelectorAll('.nav-link-item').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-tab') === targetTab);
    });
  }

  function bindEvents() {
    if (elements.callBtn) {
      elements.callBtn.addEventListener('click', () => {
        showToast("Voice call capability coming soon!");
      });
    }

    if (elements.videoBtn) {
      elements.videoBtn.addEventListener('click', () => {
        showToast("Video call capability coming soon!");
      });
    }

    const markAllReadBtn = document.getElementById('markAllReadBtn');
    if (markAllReadBtn) {
      markAllReadBtn.addEventListener('click', markAllNotificationsRead);
    }

    const enablePushBtn = document.getElementById('enablePushBtn');
    if (enablePushBtn) {
      enablePushBtn.addEventListener('click', () => {
        if ("Notification" in window) {
          Notification.requestPermission().then(permission => {
            if (permission === "granted") {
              showToast("Desktop notifications enabled!");
              triggerDesktopPush("Soroti Youth Forum", "Desktop alerts activated successfully.");
            } else {
              showToast("Notification permission denied.");
            }
          });
        } else {
          showToast("Browser does not support desktop alerts.");
        }
      });
    }

    if (elements.tabLoginBtn) elements.tabLoginBtn.addEventListener('click', () => setAuthMode(false));
    if (elements.tabSignupBtn) elements.tabSignupBtn.addEventListener('click', () => setAuthMode(true));
    if (elements.authPageForm) elements.authPageForm.addEventListener('submit', handleAuthSubmit);
    
    const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
    if (forgotPasswordBtn) {
      forgotPasswordBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = elements.pageAuthEmail ? elements.pageAuthEmail.value.trim() : '';
        
        if (!email) {
          if (elements.authErrorMsg) {
            elements.authErrorMsg.textContent = 'Enter your email above to reset password.';
          }
          return;
        }

        try {
          await sendPasswordResetEmail(auth, email);
          showToast('Password reset link sent to your email!');
        } catch (err) {
          if (elements.authErrorMsg) {
            elements.authErrorMsg.textContent = err.message.replace('Firebase: ', '');
          }
        }
      });
    }

    if (elements.signupBtn) {
      elements.signupBtn.addEventListener('click', () => { 
        if (elements.authScreen) elements.authScreen.style.display = 'flex';
      });
    }
    
    elements.logoutBtns.forEach(btn => btn.addEventListener('click', handleLogout));

    if (elements.navBtns) {
      elements.navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          elements.navDrawer?.classList.add('open');
          elements.drawerOverlay?.classList.add('active');
        });
      });
    }

    if (elements.drawerCloseBtn) {
      elements.drawerCloseBtn.addEventListener('click', closeDrawer);
    }

    if (elements.drawerOverlay) {
      elements.drawerOverlay.addEventListener('click', closeDrawer);
    }

    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => renderFeed(e.target.value.trim()));
    }
    
    if (elements.searchActionBtn) {
      elements.searchActionBtn.addEventListener('click', () => {
        renderFeed(getCurrentSearchQuery());
      });
    }

    if (elements.postPhotoInput) {
      elements.postPhotoInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          currentPostFile = file;

          const container = document.getElementById('postPreviewContainer');
          const img = document.getElementById('postPreviewImg');
          const vid = document.getElementById('postPreviewVid');
          const aud = document.getElementById('postPreviewAud');
          const fileTxt = document.getElementById('postPreviewFile');

          if (container) {
            container.style.display = 'block';
            if (img) img.style.display = 'none';
            if (vid) vid.style.display = 'none';
            if (aud) aud.style.display = 'none';
            if (fileTxt) fileTxt.style.display = 'none';

            const url = URL.createObjectURL(file);
            if (file.type.startsWith('image/') && img) {
              img.src = url;
              img.style.display = 'block';
            } else if (file.type.startsWith('video/') && vid) {
              vid.src = url;
              vid.style.display = 'block';
            } else if (file.type.startsWith('audio/') && aud) {
              aud.src = url;
              aud.style.display = 'block';
            } else if (fileTxt) {
              fileTxt.textContent = `Attached File: ${file.name}`;
              fileTxt.style.display = 'block';
            }
          }
        } else {
          clearPostPreview();
        }
      });
    }

    if (elements.postFileInput) {
      elements.postFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          currentPostFile = file;

          const container = document.getElementById('postPreviewContainer');
          const fileTxt = document.getElementById('postPreviewFile');

          if (container && fileTxt) {
            container.style.display = 'block';
            fileTxt.textContent = `Attached File: ${file.name}`;
            fileTxt.style.display = 'block';
          }
        } else {
          clearPostPreview();
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('#clearPostPreviewBtn')) {
        clearPostPreview();
      }
      if (e.target.closest('#clearChatPreviewBtn')) {
        clearChatPreview();
      }

      const navLink = e.target.closest('.nav-link-item');
      if (navLink) {
        e.preventDefault();
        const targetTab = navLink.getAttribute('data-tab');
        if (targetTab) {
          switchTab(targetTab);
        }
      }
    });

    if (elements.chatFileInput) {
      elements.chatFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          currentChatFile = file;

          const container = document.getElementById('chatPreviewContainer');
          const previewText = document.getElementById('chatPreviewText');

          if (container && previewText) {
            container.style.display = 'flex';
            previewText.textContent = `Attached: ${file.name}`;
          }
        } else {
          clearChatPreview();
        }
      });
    }

    if (elements.postBtn) elements.postBtn.addEventListener('click', handleCreatePost);

    if (elements.fabBtn) {
      elements.fabBtn.addEventListener('click', () => {
        switchTab('posts');
        if (elements.postText) {
          elements.postText.focus();
          elements.postText.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    window.addEventListener('scroll', () => {
      if (elements.backToTopBtn) {
        if (window.scrollY > 200) {
          elements.backToTopBtn.classList.remove('hidden');
        } else {
          elements.backToTopBtn.classList.add('hidden');
        }
      }
    });

    if (elements.backToTopBtn) {
      elements.backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    if (elements.toastClose) {
      elements.toastClose.addEventListener('click', () => elements.toastNotice.style.display = 'none');
    }

    if (elements.chatCloseBtn) {
      elements.chatCloseBtn.addEventListener('click', () => {
        elements.chatPopup.classList.add('hidden');
        if (activeChatRef && activeChatCallback) {
          off(activeChatRef, 'value', activeChatCallback);
        }
      });
    }

    if (elements.chatSendBtn) {
      elements.chatSendBtn.addEventListener('click', sendChatMessage);
    }

    if (elements.chatInput) {
      elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
      });
    }

    const profilePicInput = document.getElementById('profilePicInput');
    if (profilePicInput) {
      profilePicInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          uploadedAvatarFile = file;
          const previewEl = document.getElementById('settingsAvatarPreview');
          if (previewEl) {
            previewEl.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
            previewEl.style.backgroundSize = 'cover';
            previewEl.style.backgroundPosition = 'center';
            previewEl.textContent = '';
          }
        }
      });
    }

    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('settingsNameInput');
        const newName = nameInput ? nameInput.value.trim() : '';
        
        if (currentUser && auth.currentUser) {
          const updates = {};
          const authUpdates = {};
          
          if (newName) {
            updates.displayName = newName;
            authUpdates.displayName = newName;
          }
          
          if (uploadedAvatarFile) {
            showToast('Uploading profile image...');
            const avatarUrl = await uploadMediaFile(uploadedAvatarFile, 'user_avatars');
            if (avatarUrl) {
              updates.avatarUrl = avatarUrl;
              authUpdates.photoURL = avatarUrl;
              currentUser.avatarUrl = avatarUrl;
            }
          }

          try {
            await updateProfile(auth.currentUser, authUpdates);
            await update(ref(database, `users/${currentUser.uid}`), updates);
            if (newName) currentUser.name = newName;
            uploadedAvatarFile = null;
            updateUserUI();
            showToast('Settings updated!');
          } catch (err) {
            console.error("Could not save settings:", err);
            showToast('Failed to update settings.');
          }
        }
      });
    }
    
    elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });
  }

  init();
});