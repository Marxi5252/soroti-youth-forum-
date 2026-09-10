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
let userBookmarks = {};
let pendingRequests = [];
let sentRequests = [];
let callHistoryList = [];
let currentUser = null;
let postsLimit = 10;
let currentPostsQueryRef = null;
let isFeedLoading = false;

let modalCurrentUid = null;
let modalPostsLimit = 5;

let activeChatRoom = null;
let activeChatRecipientUid = null;
let activeChatRecipientName = null;
let activeChatRef = null;
let activeChatCallback = null;
let activeTypingListenerRef = null;
let activeTypingListenerCallback = null;

let callHistoryRef = null;
let callHistoryCallback = null;
let friendsRef = null;
let friendsCallback = null;
let bookmarksRef = null;
let bookmarksCallback = null;
let requestsRef = null;
let requestsCallback = null;
let sentRequestsRef = null;
let sentRequestsCallback = null;
let connectedRef = null;
let connectedCallback = null;

let currentPostFile = null;
let currentChatFile = null;
let currentCallStream = null;
let callStartTime = null;
let activeCallType = 'voice';

let typingTimeout = null;
let lastFocusedInput = null;

// 4. HELPER FUNCTIONS
function timeAgo(timestamp) {
  if (!timestamp) return 'Recently';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

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
  const MAX_SIZE_BYTES = 5 * 1024 * 1024;
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

function applyAvatarStyle(element, avatarUrl, name) {
  if (!element) return;
  if (avatarUrl) {
    element.style.backgroundImage = `url("${avatarUrl}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.textContent = '';
  } else {
    element.style.backgroundImage = 'none';
    element.textContent = getInitials(name);
  }
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
  const toastText = document.getElementById('toastMsgText');
  if (!toastNotice || !toastText) return;
  toastText.innerHTML = message;
  toastNotice.style.display = 'flex';
  setTimeout(() => { toastNotice.style.display = 'none'; }, 4000);
}

function getCurrentSearchQuery() {
  const searchInput = document.getElementById('searchInput');
  return searchInput ? searchInput.value.trim() : '';
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
  if (callHistoryRef && callHistoryCallback) off(callHistoryRef, 'value', callHistoryCallback);
  if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
  if (bookmarksRef && bookmarksCallback) off(bookmarksRef, 'value', bookmarksCallback);
  if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
  if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
  if (connectedRef && connectedCallback) off(connectedRef, 'value', connectedCallback);
  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  if (activeTypingListenerRef && activeTypingListenerCallback) off(activeTypingListenerRef, 'value', activeTypingListenerCallback);

  callHistoryRef = null; callHistoryCallback = null;
  friendsRef = null; friendsCallback = null;
  bookmarksRef = null; bookmarksCallback = null;
  requestsRef = null; requestsCallback = null;
  sentRequestsRef = null; sentRequestsCallback = null;
  connectedRef = null; connectedCallback = null;
  activeChatRef = null; activeChatCallback = null;
  activeTypingListenerRef = null; activeTypingListenerCallback = null;
}

function listenToUserSocialData(uid) {
  // Friends Listener
  friendsRef = ref(database, `friends/${uid}`);
  friendsCallback = (snapshot) => {
    const data = snapshot.val();
    friendsList = data ? Object.keys(data) : [];
    renderFriendsView();
    renderSidebarMembers();
  };
  onValue(friendsRef, friendsCallback);

  // Incoming Friend Requests Listener
  requestsRef = ref(database, `friendRequests/${uid}`);
  requestsCallback = (snapshot) => {
    const data = snapshot.val();
    pendingRequests = data ? Object.entries(data).map(([fromUid, req]) => ({ uid: fromUid, ...req })) : [];
    renderFriendsView();
  };
  onValue(requestsRef, requestsCallback);

  // Sent Friend Requests Listener
  sentRequestsRef = ref(database, `sentRequests/${uid}`);
  sentRequestsCallback = (snapshot) => {
    const data = snapshot.val();
    sentRequests = data ? Object.keys(data) : [];
    renderFriendsView();
  };
  onValue(sentRequestsRef, sentRequestsCallback);

  // Bookmarks Listener
  bookmarksRef = ref(database, `users/${uid}/bookmarks`);
  bookmarksCallback = (snapshot) => {
    const data = snapshot.val();
    userBookmarks = data || {};
    renderFeed(getCurrentSearchQuery());
  };
  onValue(bookmarksRef, bookmarksCallback);
}

// 5. GLOBAL INTERACTIVE WINDOW FUNCTIONS
window.clearPostPreview = function() {
  currentPostFile = null;
  const previewContainer = document.getElementById('postPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
  const postPhotoInput = document.getElementById('postPhotoInput');
  const postFileInput = document.getElementById('postFileInput');
  if (postPhotoInput) postPhotoInput.value = '';
  if (postFileInput) postFileInput.value = '';
};

window.clearChatPreview = function() {
  currentChatFile = null;
  const chatPreviewContainer = document.getElementById('chatPreviewContainer');
  if (chatPreviewContainer) chatPreviewContainer.style.display = 'none';
  const chatFileInput = document.getElementById('chatFileInput');
  if (chatFileInput) chatFileInput.value = '';
};

window.navigateToPost = function(postId) {
  const profileModal = document.getElementById('profileModal');
  if (profileModal) profileModal.classList.add('hidden');

  window.switchTab('posts');

  setTimeout(() => {
    let postEl = document.getElementById(`post-${postId}`);
    if (!postEl) {
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value) searchInput.value = '';
      renderFeed('');
      postEl = document.getElementById(`post-${postId}`);
    }

    if (postEl) {
      postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      postEl.classList.remove('highlight-post');
      void postEl.offsetWidth;
      postEl.classList.add('highlight-post');

      setTimeout(() => {
        postEl.classList.remove('highlight-post');
      }, 3000);

      showToast('Navigated to post.');
    } else {
      showToast('Post could not be located in feed.');
    }
  }, 150);
};

window.openAvatarLightbox = function(avatarUrl, userName) {
  const lightboxModal = document.getElementById('avatarLightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxFallback = document.getElementById('lightboxFallbackAvatar');
  const lightboxName = document.getElementById('lightboxUserName');

  if (!lightboxModal) return;
  if (lightboxName) lightboxName.textContent = `${userName || 'Member'}'s Profile Picture`;

  if (avatarUrl) {
    if (lightboxImg) {
      lightboxImg.src = avatarUrl;
      lightboxImg.classList.remove('hidden');
    }
    if (lightboxFallback) lightboxFallback.classList.add('hidden');
  } else {
    if (lightboxImg) lightboxImg.classList.add('hidden');
    if (lightboxFallback) {
      lightboxFallback.classList.remove('hidden');
      lightboxFallback.style.backgroundImage = 'none';
      lightboxFallback.textContent = getInitials(userName);
    }
  }

  lightboxModal.classList.remove('hidden');
};

window.toggleBookmark = async function(button, postId) {
  if (!currentUser) {
    showToast("Please log in to bookmark posts.");
    return;
  }
  try {
    const bookmarkRef = ref(database, `users/${currentUser.uid}/bookmarks/${postId}`);
    const snapshot = await get(bookmarkRef);
    
    if (snapshot.exists()) {
      await remove(bookmarkRef);
      if (button) button.classList.remove('active');
      showToast("Bookmark removed.");
    } else {
      await set(bookmarkRef, Date.now());
      if (button) button.classList.add('active');
      showToast("Post bookmarked!");
    }
  } catch (err) {
    console.error("Failed to toggle bookmark:", err);
  }
};

window.triggerTypingStatus = function() {
  if (!currentUser || !activeChatRoom) return;
  const typingRef = ref(database, `typing/${activeChatRoom}/${currentUser.uid}`);
  set(typingRef, true);
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    set(typingRef, false);
  }, 2000);
};

window.toggleEmojiPicker = function(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('emoji-picker-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
};

window.insertEmoji = function(emoji) {
  const activeInput = lastFocusedInput || document.getElementById('chatInput') || document.getElementById('postText');
  if (activeInput) {
    const start = activeInput.selectionStart || 0;
    const end = activeInput.selectionEnd || 0;
    const text = activeInput.value;
    activeInput.value = text.substring(0, start) + emoji + text.substring(end);
    activeInput.selectionStart = activeInput.selectionEnd = start + emoji.length;
    activeInput.focus();
  }
  document.getElementById('emoji-picker-dropdown')?.classList.add('hidden');
};

window.markMessagesRead = async function(chatRoomId) {
  if (!currentUser || !chatRoomId) return;
  try {
    const chatRef = ref(database, `chats/${chatRoomId}`);
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const updates = {};
      Object.entries(snapshot.val()).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) {
          updates[`${msgId}/read`] = true;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(chatRef, updates);
      }
    }
  } catch (err) {
    console.error("Failed to mark messages read:", err);
  }
};

window.renderModalUserPosts = function() {
  const container = document.getElementById('modalUserPostsContainer');
  const badge = document.getElementById('modalPostsCountBadge');
  if (!container) return;

  const userPosts = postsList.filter(p => p.uid === modalCurrentUid);
  if (badge) badge.textContent = `${userPosts.length} posts`;

  if (userPosts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No posts shared yet.</div>`;
    return;
  }

  const visiblePosts = userPosts.slice(0, modalPostsLimit);

  container.innerHTML = visiblePosts.map(post => {
    const displayTime = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');
    let attachmentHTML = '';
    if (post.attachment) {
      const type = post.attachmentType || '';
      if (type === 'image') {
        attachmentHTML = `<img src="${escapeHTML(post.attachment)}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-top: 6px;" />`;
      } else if (type === 'video') {
        attachmentHTML = `<video src="${escapeHTML(post.attachment)}" controls style="width: 100%; max-height: 180px; border-radius: 6px; margin-top: 6px;"></video>`;
      }
    }

    return `
      <div class="modal-post-item" onclick="navigateToPost('${post.id}')" style="background: var(--item-hover-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; margin-bottom: 8px; text-align: left; cursor: pointer; transition: transform 0.2s, border-color 0.2s;" onmouseover="this.style.borderColor='var(--color-red)'" onmouseout="this.style.borderColor='var(--border-color)'">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.7; margin-bottom: 4px;">
          <span><i class="fa-regular fa-clock"></i> ${escapeHTML(displayTime)}</span>
          <span style="color: var(--color-red); font-weight: bold;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View Post</span>
        </div>
        ${post.content ? `<p style="font-size: 13px; line-height: 1.4; margin: 0;">${escapeHTML(post.content)}</p>` : ''}
        ${attachmentHTML}
      </div>
    `;
  }).join('');

  if (modalPostsLimit < userPosts.length) {
    container.innerHTML += `
      <div id="modalPostsScrollHint" style="text-align: center; font-size: 11px; color: #888; padding: 8px 0;">
        <i class="fa-solid fa-circle-notch fa-spin"></i> Scroll down to load more user posts...
      </div>
    `;
  }

  if (!container.dataset.hasScrollListener) {
    container.dataset.hasScrollListener = "true";
    container.addEventListener('scroll', () => {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 30) {
        const totalUserPosts = postsList.filter(p => p.uid === modalCurrentUid).length;
        if (modalPostsLimit < totalUserPosts) {
          modalPostsLimit += 5;
          window.renderModalUserPosts();
        }
      }
    });
  }
};

window.openUserProfile = function(uid) {
  let user = usersList.find(u => u.uid === uid);
  if (!user && currentUser && currentUser.uid === uid) {
    user = currentUser;
  }
  if (!user) return;

  const modal = document.getElementById('profileModal');
  const nameEl = document.getElementById('modalProfileName');
  const emailEl = document.getElementById('modalProfileEmail');
  const avatarEl = document.getElementById('modalProfileAvatar');
  const statusEl = document.getElementById('modalProfileStatus');
  const postCountEl = document.getElementById('modalProfilePostCount');
  const actionsEl = document.getElementById('modalProfileActions');

  const displayName = user.displayName || user.name || 'Member';

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = user.email || '';
  
  applyAvatarStyle(avatarEl, user.avatarUrl, displayName);

  if (avatarEl) {
    avatarEl.onclick = () => window.openAvatarLightbox(user.avatarUrl, displayName);
  }

  if (statusEl) {
    statusEl.textContent = user.isOnline ? 'Online' : 'Offline';
    statusEl.className = `status-pill ${user.isOnline ? 'online' : 'offline'}`;
  }

  const userPosts = postsList.filter(p => p.uid === uid);
  if (postCountEl) postCountEl.textContent = userPosts.length;

  if (actionsEl && currentUser) {
    if (currentUser.uid !== uid) {
      const isFriend = friendsList.includes(uid);
      const isSent = sentRequests.includes(uid);
      const pendingReq = pendingRequests.find(req => req.uid === uid);

      let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
      if (isFriend) {
        actionBtn = `<button class="chat-btn" onclick="removeFriend('${uid}')"><i class="fa-solid fa-user-minus"></i> Unfriend</button>`;
      } else if (pendingReq) {
        actionBtn = `<button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${uid}', '${escapeHTML(pendingReq.fromName || displayName)}')"><i class="fa-solid fa-user-check"></i> Accept Request</button>`;
      } else if (isSent) {
        actionBtn = `<button class="chat-btn" disabled style="opacity: 0.6;"><i class="fa-solid fa-clock"></i> Request Sent</button>`;
      }

      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="openChatFromTab('${uid}', '${escapeHTML(displayName)}')"><i class="fa-solid fa-comment"></i> Send Message</button>
        ${actionBtn}
      `;
    } else {
      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="document.getElementById('profileModal').classList.add('hidden'); switchTab('settings');"><i class="fa-solid fa-camera"></i> Change Custom Picture</button>
      `;
    }
  }

  modalCurrentUid = uid;
  modalPostsLimit = 5;
  window.renderModalUserPosts();

  if (modal) modal.classList.remove('hidden');
};

window.startCall = function(isVideo) {
  if (!currentUser) {
    showToast("Please log in to make calls.");
    return;
  }
  activeCallType = isVideo ? 'video' : 'voice';
  const modal = document.getElementById('callModal');
  const statusText = document.getElementById('callStatusText');
  const userNameText = document.getElementById('callUserName');
  const videoPreview = document.getElementById('callVideoPreview');
  const localVideo = document.getElementById('localVideo');
  const avatarEl = document.getElementById('callAvatar');

  if (!modal) return;
  modal.classList.remove('hidden');
  
  const recipientName = activeChatRecipientName || 'Member';
  if (userNameText) userNameText.textContent = recipientName;
  if (avatarEl) avatarEl.textContent = getInitials(recipientName);

  if (statusText) statusText.textContent = isVideo ? 'Connecting Video Call...' : 'Connecting Voice Call...';
  callStartTime = Date.now();

  const constraints = isVideo ? { video: true, audio: true } : { audio: true };

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        currentCallStream = stream;
        if (isVideo && videoPreview) {
          videoPreview.classList.remove('hidden');
          if (localVideo) localVideo.srcObject = stream;
        }
        if (statusText) statusText.textContent = isVideo ? 'Video Call Connected' : 'Voice Call Connected';
      })
      .catch(err => {
        console.warn("Media device access error:", err);
        if (statusText) statusText.textContent = 'Call Active (Audio simulated)';
      });
  } else {
    if (statusText) statusText.textContent = 'Call Connected';
  }
};

window.endCall = async function() {
  const modal = document.getElementById('callModal');
  if (currentCallStream) {
    currentCallStream.getTracks().forEach(track => track.stop());
    currentCallStream = null;
  }
  if (modal) modal.classList.add('hidden');
  const videoPreview = document.getElementById('callVideoPreview');
  if (videoPreview) videoPreview.classList.add('hidden');

  if (currentUser && activeChatRecipientUid) {
    const durationSecs = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const minutes = Math.floor(durationSecs / 60);
    const seconds = durationSecs % 60;
    const durationFormatted = `${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;

    try {
      const callRecordRef = push(ref(database, `calls/${currentUser.uid}`));
      await set(callRecordRef, {
        peerUid: activeChatRecipientUid,
        peerName: activeChatRecipientName || 'Member',
        type: activeCallType,
        duration: durationFormatted,
        createdAt: Date.now(),
        status: 'Completed'
      });
    } catch (err) {
      console.warn("Could not save call history:", err);
    }
  }

  showToast('Call ended.');
};

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
    if (modalCurrentUid === targetUid) window.openUserProfile(targetUid);
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
    if (modalCurrentUid === senderUid) window.openUserProfile(senderUid);
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
    if (modalCurrentUid === friendUid) window.openUserProfile(friendUid);
  } catch (err) {
    console.error("Failed to remove friend:", err);
  }
};

window.toggleLike = async function(id) {
  if (!currentUser) return;
  try {
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
    const likeSnap = await get(likeRef);

    if (likeSnap.exists()) {
      await remove(likeRef);
    } else {
      await set(likeRef, true);
      await remove(dislikeRef);
      const postRef = ref(database, `posts/${id}`);
      const snapshot = await get(postRef);
      if (snapshot.exists()) {
        const post = snapshot.val();
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
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const snapshot = await get(dislikeRef);

    if (snapshot.exists()) {
      await remove(dislikeRef);
    } else {
      await set(dislikeRef, true);
      await remove(likeRef);
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
        uid: currentUser ? currentUser.uid : null,
        authorAvatarUrl: currentUser ? currentUser.avatarUrl : null,
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
  const typingIndicator = document.getElementById('typing-indicator');

  if (!chatPopup) return;

  activeChatRecipientUid = recipientUid;
  activeChatRecipientName = recipientName || 'Member';

  chatFriendName.innerHTML = `<i class="fa-solid fa-grip-lines" style="margin-right: 6px; opacity: 0.6;"></i> Chat with ${escapeHTML(activeChatRecipientName)}`;
  chatPopup.classList.remove('hidden');

  const roomPath = recipientUid ? [currentUser.uid, recipientUid].sort().join('_') : 'global_room';
  activeChatRoom = `direct_${roomPath}`;

  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  if (activeTypingListenerRef && activeTypingListenerCallback) off(activeTypingListenerRef, 'value', activeTypingListenerCallback);

  chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(activeChatRecipientName)}</div>`;

  activeTypingListenerRef = ref(database, `typing/${activeChatRoom}`);
  activeTypingListenerCallback = (snap) => {
    if (!typingIndicator) return;
    const data = snap.val() || {};
    const isSomeoneElseTyping = Object.keys(data).some(uid => uid !== currentUser.uid && data[uid] === true);
    typingIndicator.style.display = isSomeoneElseTyping ? 'flex' : 'none';
  };
  onValue(activeTypingListenerRef, activeTypingListenerCallback);

  activeChatRef = ref(database, `chats/${activeChatRoom}`);
  activeChatCallback = (snapshot) => {
    const data = snapshot.val();
    chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(activeChatRecipientName)}</div>`;
    if (data) {
      let hasUnread = false;
      Object.entries(data).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) hasUnread = true;

        const msgEl = document.createElement('div');
        const isMe = msg.senderUid === currentUser.uid;
        msgEl.className = isMe ? 'chat-msg outgoing' : 'chat-msg incoming';
        
        let html = `<div>${escapeHTML(msg.text || '')}`;
        if (isMe) {
          html += ` <span class="read-receipt" data-message-id="${msgId}"><i class="fa-solid fa-check-double ${msg.read ? 'text-blue-500' : ''}"></i></span>`;
        }
        html += `</div>`;
        
        if (msg.attachment) {
          const isImg = (msg.attachmentType === 'image') || msg.attachment.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i);
          if (isImg) {
            html += `<div style="margin-top: 5px;"><img src="${escapeHTML(msg.attachment)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; display: block; object-fit: cover;" /></div>`;
          } else {
            html += `
              <div style="margin-top: 5px; background: rgba(0,0,0,0.1); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                <a href="${escapeHTML(msg.attachment)}" target="_blank" download style="color: inherit; font-weight: bold; text-decoration: underline; display: flex; align-items: center; gap: 6px;">
                  <i class="fa-solid fa-file-arrow-down"></i> ${escapeHTML(msg.attachmentName || 'Download Attachment')}
                </a>
              </div>`;
          }
        }
        msgEl.innerHTML = html;
        chatMessages.appendChild(msgEl);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (hasUnread) window.markMessagesRead(activeChatRoom);
    }
  };

  onValue(activeChatRef, activeChatCallback);
};

window.openChatFromTab = function(friendUid, friendName) {
  document.getElementById('profileModal')?.classList.add('hidden');
  window.openChat(friendUid, friendName);
};

window.switchTab = function(tabName) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabViews = document.querySelectorAll('.tab-view');
  
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  tabViews.forEach(view => {
    if (view.id === `${tabName}View`) view.classList.remove('hidden');
    else view.classList.add('hidden');
  });
};

// 6. REALTIME LISTENERS & RENDERING
function listenToPosts() {
  if (currentPostsQueryRef) off(currentPostsQueryRef);
  const postsRef = ref(database, 'posts');
  currentPostsQueryRef = query(postsRef, limitToLast(postsLimit));

  onValue(currentPostsQueryRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      postsList = Object.entries(data).map(([id, post]) => ({ id, ...post })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      postsList = [];
    }
    renderFeed(getCurrentSearchQuery());
  });
}

function listenToUsers() {
  const usersRef = ref(database, 'users');
  onValue(usersRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      usersList = Object.entries(data).map(([uid, u]) => ({ uid, ...u }));
    } else {
      usersList = [];
    }
    renderFeed(getCurrentSearchQuery());
    renderSidebarMembers();
    renderFriendsView();
  });
}

function renderSidebarMembers() {
  const sidebarContainer = document.getElementById('sidebarMembersContainer');
  if (!sidebarContainer) return;

  const onlineFriends = usersList.filter(u => currentUser && friendsList.includes(u.uid) && u.isOnline);
  if (onlineFriends.length === 0) {
    sidebarContainer.innerHTML = `<p style="font-size: 11px; color: #888;">No friends active right now.</p>`;
    return;
  }

  sidebarContainer.innerHTML = onlineFriends.map(user => `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; cursor: pointer;" onclick="openChatFromTab('${user.uid}', '${escapeHTML(user.displayName || user.name)}')">
      <div style="display: flex; align-items: center; gap: 8px;">
        <div class="avatar profile-avatar online" style="width: 26px; height: 26px; font-size: 10px; ${user.avatarUrl ? `background-image: url('${user.avatarUrl}'); background-size: cover; background-position: center;` : ''}">${!user.avatarUrl ? getInitials(user.displayName || user.name) : ''}</div>
        <span style="font-size: 12px; font-weight: 500; color: var(--text-color);">${escapeHTML(user.displayName || user.name)}</span>
      </div>
      <span style="width: 8px; height: 8px; background: #2ec4b6; border-radius: 50%;"></span>
    </div>
  `).join('');
}

function renderFriendsView() {
  const container = document.getElementById('friendsListContainer');
  if (!container) return;

  const otherUsers = usersList.filter(u => currentUser && u.uid !== currentUser.uid);

  if (otherUsers.length === 0 && pendingRequests.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; padding: 20px;">No other members found in the network.</div>`;
    return;
  }

  let html = '';

  if (pendingRequests.length > 0) {
    html += `<h4 style="font-size: 13px; margin-bottom: 10px; color: var(--color-red);">Pending Friend Requests (${pendingRequests.length})</h4>`;
    pendingRequests.forEach(req => {
      const senderUser = usersList.find(u => u.uid === req.uid);
      const name = senderUser?.displayName || req.fromName || 'Member';
      const avatarUrl = senderUser?.avatarUrl || null;
      html += `
        <div class="friend-item card" style="margin-bottom: 10px; padding: 10px;">
          <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${req.uid}')">
            <div class="avatar profile-avatar" style="${avatarUrl ? `background-image: url('${avatarUrl}'); background-size: cover; background-position: center;` : ''}">${!avatarUrl ? getInitials(name) : ''}</div>
            <div>
              <h4 style="font-size: 13px; margin: 0;">${escapeHTML(name)}</h4>
              <span style="font-size: 11px; opacity: 0.6;">Wants to connect</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="post-btn" style="padding: 6px 12px; font-size: 11px;" onclick="acceptFriendRequest('${req.uid}', '${escapeHTML(name)}')">Accept</button>
          </div>
        </div>
      `;
    });
    html += `<hr style="margin: 15px 0; border: none; border-top: 1px solid var(--border-color);" />`;
  }

  html += `<h4 style="font-size: 13px; margin-bottom: 10px;">Soroti Youth Community Members</h4>`;
  html += otherUsers.map(user => {
    const isFriend = friendsList.includes(user.uid);
    const isSent = sentRequests.includes(user.uid);
    const displayName = user.displayName || user.name || 'Member';
    const avatarUrl = user.avatarUrl || null;
    const isOnline = user.isOnline || false;

    let actionBtn = `<button class="post-btn" style="padding: 6px 12px; font-size: 11px;" onclick="sendFriendRequest('${user.uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
    if (isFriend) {
      actionBtn = `<button class="chat-btn" style="padding: 6px 12px; font-size: 11px;" onclick="removeFriend('${user.uid}')"><i class="fa-solid fa-user-minus"></i> Unfriend</button>`;
    } else if (isSent) {
      actionBtn = `<button class="chat-btn" disabled style="padding: 6px 12px; font-size: 11px; opacity: 0.6;"><i class="fa-solid fa-clock"></i> Requested</button>`;
    }

    return `
      <div class="friend-item" style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${user.uid}')">
          <div class="avatar profile-avatar ${isOnline ? 'online' : ''}" style="${avatarUrl ? `background-image: url('${avatarUrl}'); background-size: cover; background-position: center;` : ''}">${!avatarUrl ? getInitials(displayName) : ''}</div>
          <div>
            <h4 style="font-size: 13px; margin: 0; color: var(--text-color);">${escapeHTML(displayName)}</h4>
            <span style="font-size: 11px; opacity: 0.6;">${isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="chat-btn" style="padding: 6px 12px; font-size: 11px; background: var(--color-black); color: white;" onclick="openChatFromTab('${user.uid}', '${escapeHTML(displayName)}')"><i class="fa-solid fa-comment"></i> Chat</button>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function renderFeed(searchQuery = '') {
  const feedContainer = document.getElementById('feedContainer');
  if (!feedContainer) return;

  let filteredPosts = postsList;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredPosts = postsList.filter(p => 
      (p.content && p.content.toLowerCase().includes(q)) ||
      (p.author && p.author.toLowerCase().includes(q))
    );
  }

  if (filteredPosts.length === 0) {
    feedContainer.innerHTML = `
      <div class="card" style="text-align: center; color: #888; padding: 30px 15px;">
        <i class="fa-solid fa-newspaper" style="font-size: 32px; margin-bottom: 10px; color: var(--color-red);"></i>
        <p>${searchQuery ? 'No posts matched your search criteria.' : 'No posts yet. Be the first to start a conversation!'}</p>
      </div>
    `;
    return;
  }

  feedContainer.innerHTML = filteredPosts.map(post => {
    const isOwner = currentUser && (post.uid === currentUser.uid || post.authorEmail === currentUser.email);
    const postUser = post.uid ? usersList.find(u => u.uid === post.uid) : null;
    const authorName = postUser?.displayName || post.author || 'Youth Member';
    const authorAvatarUrl = postUser?.avatarUrl || post.authorAvatarUrl || null;
    const isOnline = postUser ? postUser.isOnline : false;

    const likesCount = post.likes ? Object.keys(post.likes).length : 0;
    const dislikesCount = post.dislikes ? Object.keys(post.dislikes).length : 0;
    const isLiked = currentUser && post.likes && post.likes[currentUser.uid];
    const isDisliked = currentUser && post.dislikes && post.dislikes[currentUser.uid];
    const isBookmarked = currentUser && userBookmarks[post.id];

    const commentsArr = post.comments ? Object.entries(post.comments).map(([cid, c]) => ({ id: cid, ...c })) : [];
    const commentsCount = commentsArr.length;

    let attachmentMarkup = '';
    if (post.attachment) {
      const type = post.attachmentType || '';
      if (type === 'image') {
        attachmentMarkup = `<div class="media-attachment-container"><img src="${escapeHTML(post.attachment)}" alt="Post Image" style="width:100%; max-height:380px; object-fit:cover; display:block;" /></div>`;
      } else if (type === 'video') {
        attachmentMarkup = `<div class="media-attachment-container"><video src="${escapeHTML(post.attachment)}" controls style="width:100%; max-height:380px; display:block; object-fit:cover;"></video></div>`;
      } else if (type === 'audio') {
        attachmentMarkup = `<div style="margin-bottom:12px;"><audio src="${escapeHTML(post.attachment)}" controls style="width:100%;"></audio></div>`;
      } else {
        attachmentMarkup = `
          <div style="margin-bottom: 12px; background: var(--item-hover-bg); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color);">
            <a href="${escapeHTML(post.attachment)}" target="_blank" download style="color: var(--color-red); font-weight: bold; text-decoration: underline; display: inline-flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-file-arrow-down"></i> ${escapeHTML(post.attachmentName || 'Download File')}
            </a>
          </div>
        `;
      }
    }

    const commentsListHTML = commentsArr.map(comment => {
      const commentUser = comment.uid ? usersList.find(u => u.uid === comment.uid) : null;
      const commentAvatar = commentUser?.avatarUrl || comment.authorAvatarUrl || null;
      const commentAuthorName = commentUser?.displayName || comment.author || 'Youth Member';
      const commentUid = comment.uid || '';
      const avatarInitials = getInitials(commentAuthorName);
      const avatarStyle = commentAvatar ? `background-image: url('${commentAvatar}'); background-size: cover; background-position: center;` : '';
      const clickHandlerAttr = commentUid ? `onclick="openUserProfile('${commentUid}')"` : '';

      return `
        <div style="display: flex; gap: 10px; margin-top: 10px; align-items: flex-start;">
          <div class="avatar comment-avatar" ${clickHandlerAttr} style="${avatarStyle}" title="Click to view profile">
            ${!commentAvatar ? avatarInitials : ''}
          </div>
          <div style="background: var(--item-hover-bg); border-radius: 8px; padding: 8px 12px; flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="comment-author-name" ${clickHandlerAttr} title="Click to view profile">${escapeHTML(commentAuthorName)}</span>
              <span style="font-size: 10px; opacity: 0.6;">${timeAgo(comment.createdAt)}</span>
            </div>
            <p style="font-size: 12px; margin-top: 4px; line-height: 1.3;">${escapeHTML(comment.text)}</p>
          </div>
        </div>
      `;
    }).join('');

    const postTimeFormatted = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');

    return `
      <div class="card" id="post-${post.id}">
        <div class="animated-stripe-bar"></div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="openUserProfile('${post.uid}')">
            <div class="avatar profile-avatar ${isOnline ? 'online' : ''}" style="${authorAvatarUrl ? `background-image: url('${authorAvatarUrl}'); background-size: cover; background-position: center;` : ''}">
              ${!authorAvatarUrl ? getInitials(authorName) : ''}
            </div>
            <div>
              <h4 style="font-size: 14px; margin: 0; font-weight: bold; color: var(--text-color);">${escapeHTML(authorName)}</h4>
              <span style="font-size: 11px; opacity: 0.6;">${escapeHTML(postTimeFormatted)}${post.isEdited ? ' (edited)' : ''}</span>
            </div>
          </div>
          
          <div style="display: flex; align-items: center; gap: 10px;">
            <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="toggleBookmark(this, '${post.id}')" title="Bookmark Post">
              <i class="fa-solid fa-bookmark"></i>
            </button>
            ${isOwner ? `
              <button style="background: none; border: none; color: var(--text-color); opacity: 0.6; cursor: pointer;" onclick="toggleEditPost('${post.id}')" title="Edit Post">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button style="background: none; border: none; color: var(--color-red); cursor: pointer;" onclick="deletePost('${post.id}')" title="Delete Post">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <div id="postContent-${post.id}">
          ${post.content ? `<p style="font-size: 14px; line-height: 1.5; margin-bottom: 12px; white-space: pre-line;">${escapeHTML(post.content)}</p>` : ''}
        </div>

        <div id="editPostContainer-${post.id}" class="hidden" style="margin-bottom: 12px;">
          <textarea id="editPostInput-${post.id}" style="width: 100%; border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font-size: 13px; background: var(--card-bg); color: var(--text-color);">${escapeHTML(post.content || '')}</textarea>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px;">
            <button class="post-btn" style="padding: 4px 10px; font-size: 12px;" onclick="saveEditPost('${post.id}')">Save</button>
            <button class="chat-btn" style="padding: 4px 10px; font-size: 12px;" onclick="toggleEditPost('${post.id}')">Cancel</button>
          </div>
        </div>

        ${attachmentMarkup}

        <div style="display: flex; gap: 15px; border-top: 1px solid var(--border-color); padding-top: 10px; font-size: 13px;">
          <button style="background: none; border: none; cursor: pointer; color: ${isLiked ? 'var(--color-red)' : 'var(--text-color)'}; font-weight: bold; display: flex; align-items: center; gap: 5px;" onclick="toggleLike('${post.id}')">
            <i class="fa-solid fa-heart"></i> <span>${likesCount}</span>
          </button>
          <button style="background: none; border: none; cursor: pointer; color: ${isDisliked ? 'var(--color-red)' : 'var(--text-color)'}; font-weight: bold; display: flex; align-items: center; gap: 5px;" onclick="toggleDislike('${post.id}')">
            <i class="fa-solid fa-thumbs-down"></i> <span>${dislikesCount}</span>
          </button>
          <button style="background: none; border: none; cursor: pointer; color: var(--text-color); font-weight: bold; display: flex; align-items: center; gap: 5px;" onclick="toggleCommentSection('${post.id}')">
            <i class="fa-solid fa-comment"></i> <span>${commentsCount}</span>
          </button>
        </div>

        <div id="commentSection-${post.id}" class="hidden" style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 10px;">
          <div style="display: flex; gap: 8px;">
            <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex: 1; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 12px; background: var(--card-bg); color: var(--text-color);" />
            <button class="post-btn" style="padding: 6px 12px; font-size: 12px;" onclick="addComment('${post.id}')">Reply</button>
          </div>
          <div style="margin-top: 10px;">${commentsListHTML}</div>
        </div>
      </div>
    `;
  }).join('');
}

// 7. AUTHENTICATION & APP BOOTSTRAP
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userRef = ref(database, `users/${user.uid}`);
    const snap = await get(userRef);
    if (snap.exists()) {
      const userData = snap.val();
      currentUser.name = userData.displayName || user.displayName || user.email.split('@')[0];
      currentUser.avatarUrl = userData.avatarUrl || user.photoURL || null;
    } else {
      currentUser.name = user.displayName || user.email.split('@')[0];
      currentUser.avatarUrl = user.photoURL || null;
    }

    setupPresenceSystem(user);
    listenToPosts();
    listenToUsers();
    listenToUserSocialData(user.uid);

    document.getElementById('authScreen')?.classList.add('hidden');
    document.getElementById('appContent')?.classList.remove('hidden');

    const topBarUserProfile = document.getElementById('topBarUserProfile');
    const signupBtn = document.querySelector('.signup-btn');
    if (topBarUserProfile) topBarUserProfile.classList.remove('hidden');
    if (signupBtn) signupBtn.classList.add('hidden');

    const profileNameEl = document.querySelectorAll('.profile-name');
    const profileEmailEl = document.querySelectorAll('.profile-email');
    profileNameEl.forEach(el => el.textContent = currentUser.name);
    profileEmailEl.forEach(el => el.textContent = currentUser.email);

    const drawerProfileAvatar = document.getElementById('drawerProfileAvatar');
    const topBarProfileAvatar = document.getElementById('topBarProfileAvatar');
    const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
    applyAvatarStyle(drawerProfileAvatar, currentUser.avatarUrl, currentUser.name);
    applyAvatarStyle(topBarProfileAvatar, currentUser.avatarUrl, currentUser.name);
    applyAvatarStyle(settingsAvatarPreview, currentUser.avatarUrl, currentUser.name);

    if (settingsAvatarPreview) {
      settingsAvatarPreview.onclick = () => window.openAvatarLightbox(currentUser.avatarUrl, currentUser.name);
    }
  } else {
    detachUserListeners();
    currentUser = null;
    document.getElementById('authScreen')?.classList.remove('hidden');
    document.getElementById('appContent')?.classList.add('hidden');
  }
});

// UI EVENT LISTENERS SETUP
document.addEventListener('DOMContentLoaded', () => {
  const authPageForm = document.getElementById('authPageForm');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabSignupBtn = document.getElementById('tabSignupBtn');
  const pageAuthSubmitBtn = document.getElementById('pageAuthSubmitBtn');
  const fullNameGroup = document.getElementById('fullNameGroup');
  const phoneGroup = document.getElementById('phoneGroup');
  const districtGroup = document.getElementById('districtGroup');
  const villageGroup = document.getElementById('villageGroup');
  const authRedirectBtn = document.getElementById('authRedirectBtn');
  const authErrorMsg = document.getElementById('authErrorMsg');

  let isSignupMode = false;

  if (tabLoginBtn && tabSignupBtn) {
    tabLoginBtn.addEventListener('click', () => {
      isSignupMode = false;
      tabLoginBtn.classList.add('active');
      tabSignupBtn.classList.remove('active');
      fullNameGroup?.classList.add('hidden');
      phoneGroup?.classList.add('hidden');
      districtGroup?.classList.add('hidden');
      villageGroup?.classList.add('hidden');
      if (pageAuthSubmitBtn) pageAuthSubmitBtn.textContent = 'Log In';
      document.getElementById('forgotPasswordWrapper')?.classList.remove('hidden');
      if (authErrorMsg) authErrorMsg.style.display = 'none';
    });

    tabSignupBtn.addEventListener('click', () => {
      isSignupMode = true;
      tabSignupBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      fullNameGroup?.classList.remove('hidden');
      phoneGroup?.classList.remove('hidden');
      districtGroup?.classList.remove('hidden');
      villageGroup?.classList.remove('hidden');
      if (pageAuthSubmitBtn) pageAuthSubmitBtn.textContent = 'Sign Up';
      document.getElementById('forgotPasswordWrapper')?.classList.add('hidden');
      if (authErrorMsg) authErrorMsg.style.display = 'none';
    });
  }

  if (authRedirectBtn) {
    authRedirectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isSignupMode) tabLoginBtn?.click();
      else tabSignupBtn?.click();
    });
  }

  if (authPageForm) {
    authPageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('pageAuthEmail')?.value.trim();
      const password = document.getElementById('pageAuthPassword')?.value;
      const fullName = document.getElementById('pageAuthName')?.value.trim();
      const phone = document.getElementById('pageAuthPhone')?.value.trim();
      const district = document.getElementById('pageAuthDistrict')?.value.trim();
      const village = document.getElementById('pageAuthVillage')?.value.trim();

      if (authErrorMsg) authErrorMsg.style.display = 'none';

      try {
        if (isSignupMode) {
          if (!fullName) {
            if (authErrorMsg) { authErrorMsg.textContent = "Please enter your full name."; authErrorMsg.style.display = 'block'; }
            return;
          }
          const creds = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(creds.user, { displayName: fullName });
          await set(ref(database, `users/${creds.user.uid}`), {
            uid: creds.user.uid,
            name: fullName,
            displayName: fullName,
            email: email,
            phone: phone || '',
            district: district || '',
            village: village || '',
            avatarUrl: '',
            isOnline: true,
            createdAt: serverTimestamp()
          });
          showToast("Account created successfully!");
        } else {
          await signInWithEmailAndPassword(auth, email, password);
          showToast("Logged in successfully!");
        }
      } catch (err) {
        console.error("Auth error:", err);
        if (authErrorMsg) {
          authErrorMsg.textContent = err.message;
          authErrorMsg.style.display = 'block';
        }
      }
    });
  }

  document.querySelectorAll('.nav-link-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.switchTab(link.dataset.tab);
      closeDrawer();
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.switchTab(btn.dataset.tab);
    });
  });

  const navDrawer = document.getElementById('navDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navDrawer?.classList.add('open');
      drawerOverlay?.classList.add('active');
    });
  });

  const closeDrawerFunc = () => {
    navDrawer?.classList.remove('open');
    drawerOverlay?.classList.remove('active');
  };

  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeDrawerFunc);
  drawerOverlay?.addEventListener('click', closeDrawerFunc);

  const themeToggleBtns = document.querySelectorAll('.themeToggleBtn');
  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
    });
  });

  document.querySelectorAll('.logout-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (currentUser) {
        await set(ref(database, `users/${currentUser.uid}/isOnline`), false);
      }
      signOut(auth).then(() => {
        showToast("Logged out.");
      });
    });
  });

  // FAB Speed Dial Toggle
  const fabBtn = document.getElementById('fabBtn');
  const fabOptions = document.getElementById('fabOptions');
  if (fabBtn && fabOptions) {
    fabBtn.addEventListener('click', () => {
      fabBtn.classList.toggle('active');
      fabOptions.classList.toggle('hidden');
    });
  }

  document.getElementById('fabChatBtn')?.addEventListener('click', () => {
    window.switchTab('chats');
    fabBtn?.classList.remove('active');
    fabOptions?.classList.add('hidden');
  });

  document.getElementById('fabCreatePostBtn')?.addEventListener('click', () => {
    window.switchTab('posts');
    document.getElementById('postText')?.focus();
    fabBtn?.classList.remove('active');
    fabOptions?.classList.add('hidden');
  });

  // Create Post File Handling
  const postPhotoInput = document.getElementById('postPhotoInput');
  const postFileInput = document.getElementById('postFileInput');
  if (postPhotoInput) {
    postPhotoInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      currentPostFile = file;
      const previewContainer = document.getElementById('postPreviewContainer');
      const previewImg = document.getElementById('postPreviewImg');
      const previewVid = document.getElementById('postPreviewVid');
      
      previewContainer.style.display = 'block';
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('image/')) {
        previewImg.src = url;
        previewImg.style.display = 'block';
        previewVid.style.display = 'none';
      } else if (file.type.startsWith('video/')) {
        previewVid.src = url;
        previewVid.style.display = 'block';
        previewImg.style.display = 'none';
      }
    });
  }

  // Create Post Submit
  const createPostSubmitBtn = document.getElementById('createPostSubmitBtn');
  if (createPostSubmitBtn) {
    createPostSubmitBtn.addEventListener('click', async () => {
      const textInput = document.getElementById('postText');
      const content = textInput ? textInput.value.trim() : '';
      if (!content && !currentPostFile) {
        showToast("Please enter text or attach media to post.");
        return;
      }

      createPostSubmitBtn.disabled = true;
      createPostSubmitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Posting...';

      try {
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;

        if (currentPostFile) {
          attachmentName = currentPostFile.name;
          attachmentUrl = await uploadMediaFile(currentPostFile, 'post_media');
          if (currentPostFile.type.startsWith('image/')) attachmentType = 'image';
          else if (currentPostFile.type.startsWith('video/')) attachmentType = 'video';
          else if (currentPostFile.type.startsWith('audio/')) attachmentType = 'audio';
          else attachmentType = 'file';
        }

        const newPostRef = push(ref(database, 'posts'));
        await set(newPostRef, {
          uid: currentUser.uid,
          author: currentUser.name,
          authorEmail: currentUser.email,
          authorAvatarUrl: currentUser.avatarUrl || '',
          content: content,
          attachment: attachmentUrl || '',
          attachmentType: attachmentType || '',
          attachmentName: attachmentName || '',
          createdAt: Date.now(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        if (textInput) textInput.value = '';
        window.clearPostPreview();
        showToast("Post published successfully!");
      } catch (err) {
        console.error("Failed to create post:", err);
        showToast("Failed to publish post.");
      } finally {
        createPostSubmitBtn.disabled = false;
        createPostSubmitBtn.textContent = 'Post';
      }
    });
  }

  // Search input live trigger
  const searchInput = document.getElementById('searchInput');
  const searchActionBtn = document.getElementById('searchActionBtn');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderFeed(searchInput.value.trim()));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') renderFeed(searchInput.value.trim());
    });
  }
  if (searchActionBtn) {
    searchActionBtn.addEventListener('click', () => renderFeed(searchInput ? searchInput.value.trim() : ''));
  }

  // Chat send message
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatInput = document.getElementById('chatInput');
  if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', async () => {
      const text = chatInput.value.trim();
      if (!text && !currentChatFile) return;

      try {
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;

        if (currentChatFile) {
          attachmentName = currentChatFile.name;
          attachmentUrl = await uploadMediaFile(currentChatFile, 'chat_media');
          attachmentType = currentChatFile.type.startsWith('image/') ? 'image' : 'file';
        }

        const msgRef = push(ref(database, `chats/${activeChatRoom}`));
        await set(msgRef, {
          senderUid: currentUser.uid,
          senderName: currentUser.name,
          text: text,
          attachment: attachmentUrl || '',
          attachmentType: attachmentType || '',
          attachmentName: attachmentName || '',
          read: false,
          createdAt: Date.now()
        });

        chatInput.value = '';
        window.clearChatPreview();
        set(ref(database, `typing/${activeChatRoom}/${currentUser.uid}`), false);
      } catch (err) {
        console.error("Failed to send message:", err);
      }
    });

    chatInput.addEventListener('input', window.triggerTypingStatus);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') chatSendBtn.click();
    });
  }

  // Modal & lightbox close triggers
  document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
    document.getElementById('profileModal')?.classList.add('hidden');
  });
  document.getElementById('closeLightboxModalBtn')?.addEventListener('click', () => {
    document.getElementById('avatarLightboxModal')?.classList.add('hidden');
  });
  document.getElementById('chatCloseBtn')?.addEventListener('click', () => {
    document.getElementById('chatPopup')?.classList.add('hidden');
    if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  });

  // Call triggers
  document.getElementById('voiceCallTrigger')?.addEventListener('click', () => window.startCall(false));
  document.getElementById('videoCallTrigger')?.addEventListener('click', () => window.startCall(true));
  document.getElementById('callEndBtn')?.addEventListener('click', window.endCall);

  // Settings Save
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const profilePicInput = document.getElementById('profilePicInput');
  let selectedProfilePicFile = null;

  if (profilePicInput) {
    profilePicInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      selectedProfilePicFile = file;
      const url = URL.createObjectURL(file);
      const preview = document.getElementById('settingsAvatarPreview');
      if (preview) {
        preview.style.backgroundImage = `url("${url}")`;
        preview.style.backgroundSize = 'cover';
        preview.textContent = '';
      }
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      if (!currentUser) return;
      const nameInput = document.getElementById('settingsNameInput');
      const newName = nameInput ? nameInput.value.trim() : currentUser.name;

      saveSettingsBtn.disabled = true;
      saveSettingsBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

      try {
        let avatarUrl = currentUser.avatarUrl || '';
        if (selectedProfilePicFile) {
          avatarUrl = await uploadMediaFile(selectedProfilePicFile, 'profile_pictures');
        }

        const updates = {};
        updates[`users/${currentUser.uid}/displayName`] = newName;
        updates[`users/${currentUser.uid}/name`] = newName;
        if (avatarUrl) updates[`users/${currentUser.uid}/avatarUrl`] = avatarUrl;

        await update(ref(database), updates);
        currentUser.name = newName;
        if (avatarUrl) currentUser.avatarUrl = avatarUrl;

        showToast("Settings updated successfully!");
      } catch (err) {
        console.error("Failed to update settings:", err);
        showToast("Failed to save changes.");
      } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.textContent = 'Save Changes';
      }
    });
  }
});